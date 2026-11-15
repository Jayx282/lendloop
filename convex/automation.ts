import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { adminMutation, adminQuery } from "./functions";
import { notificationState } from "./lib/activity";
import { daysBetween, isIsoDay, todayUtc } from "./lib/dates";
import { signForN8n } from "./lib/jwt";
import { truncate } from "./lib/text";

// Functions behind the n8n HTTP endpoints (see http.ts) plus the admin
// "automation health" view. n8n never gets database access: it can only read
// the overdue list and write reminder and failure records through these.

const SWEEP_STALE_AFTER_MS = 26 * 60 * 60 * 1000; // daily job + 2h grace
// A claimed reminder stays reserved for the claiming run this long. It must be
// longer than the overdue workflow's execution timeout (15 minutes), so a run that
// is still retrying can't have its loans handed to a second, overlapping run.
export const REMINDER_LEASE_MS = 30 * 60 * 1000;

async function touchState(ctx: MutationCtx, key: string, detail?: string) {
  const existing = await ctx.db
    .query("automationState")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const value = { key, at: Date.now(), detail };
  if (existing) await ctx.db.patch(existing._id, value);
  else await ctx.db.insert("automationState", value);
}

/**
 * Fetch-and-claim: returns the overdue loans that still need today's reminder
 * and, in the same transaction, claims each one for this run ("sending" with a
 * lease). That makes reminders effectively exactly-once:
 *   - a loan already reminded today ("sent") is left out, so re-runs send nothing;
 *   - a loan claimed by another run that is still inside its lease is left out,
 *     so overlapping runs (schedule + manual, or a slow retry) can't both email it;
 *   - a "failed" reminder, or a claim whose run died, becomes eligible again.
 * Also records a heartbeat for the admin health view.
 */
export const claimOverdueReminders = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    const now = Date.now();
    const today = todayUtc(now);
    const overdue = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(200);

    const loans = [];
    let noEmail = 0;
    let inProgress = 0;
    for (const loan of overdue) {
      const reminderKey = `${loan._id}:${today}`;
      const existing = await ctx.db
        .query("reminders")
        .withIndex("by_key", (q) => q.eq("reminderKey", reminderKey))
        .unique();
      if (existing?.status === "sent") continue;
      if (existing?.status === "sending" && existing.attemptedAt > now - REMINDER_LEASE_MS) {
        inProgress++;
        continue;
      }

      const [borrower, lender, tool] = await Promise.all([
        ctx.db.get(loan.borrowerId),
        ctx.db.get(loan.lenderId),
        ctx.db.get(loan.toolId),
      ]);
      if (!borrower?.email) {
        noEmail++;
        continue;
      }

      const claim = {
        reminderKey,
        loanId: loan._id,
        day: today,
        status: "sending" as const,
        channel: "email",
        error: undefined,
        attemptedAt: now,
        executionId: truncate(runId, 64),
      };
      if (existing) await ctx.db.patch(existing._id, claim);
      else await ctx.db.insert("reminders", claim);

      // Only what the reminder email needs.
      loans.push({
        loanId: loan._id,
        reminderKey,
        borrower: { name: borrower.displayName, email: borrower.email },
        lender: { name: lender?.displayName ?? "the lender" },
        tool: { name: tool?.name ?? "the tool" },
        dueDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    await touchState(
      ctx,
      "overdue_sweep.last_fetch",
      `${loans.length} to remind, ${inProgress} in progress elsewhere, ${noEmail} without email`,
    );
    return { asOf: today, count: loans.length, loans };
  },
});

/** n8n's write-back after each reminder. Idempotent on reminderKey: "sent" is final. */
export const recordReminder = internalMutation({
  args: {
    reminderKey: v.string(),
    loanId: v.id("loans"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.string(),
    error: v.optional(v.string()),
    executionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [keyLoanId, day, ...rest] = args.reminderKey.split(":");
    if (keyLoanId !== args.loanId || !day || !isIsoDay(day) || rest.length > 0) {
      return { ok: false as const, error: "reminderKey must be <loanId>:<YYYY-MM-DD>" };
    }
    const loan = await ctx.db.get(args.loanId);
    if (!loan) return { ok: false as const, error: "unknown loan" };

    const existing = await ctx.db
      .query("reminders")
      .withIndex("by_key", (q) => q.eq("reminderKey", args.reminderKey))
      .unique();
    // "sent" is final; a retry or a re-run can't downgrade it or add a second row.
    if (existing?.status === "sent") return { ok: true as const, duplicate: true };

    const record = {
      reminderKey: args.reminderKey,
      loanId: args.loanId,
      day,
      status: args.status,
      channel: truncate(args.channel, 40),
      error: args.error ? truncate(args.error) : undefined,
      attemptedAt: Date.now(),
      executionId: args.executionId ? truncate(args.executionId, 64) : undefined,
    };
    if (existing) await ctx.db.patch(existing._id, record);
    else await ctx.db.insert("reminders", record);
    return { ok: true as const, duplicate: false };
  },
});

/** Reported by the n8n error workflow. Idempotent on executionId. */
export const recordFailure = internalMutation({
  args: {
    executionId: v.string(),
    workflowName: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationFailures")
      .withIndex("by_execution", (q) => q.eq("executionId", args.executionId))
      .unique();
    if (existing) return { duplicate: true };
    await ctx.db.insert("automationFailures", {
      executionId: truncate(args.executionId, 64),
      workflowName: truncate(args.workflowName, 120),
      node: args.node ? truncate(args.node, 120) : undefined,
      message: truncate(args.message),
      occurredAt: Date.now(),
    });
    console.error(`n8n workflow "${args.workflowName}" failed (execution ${args.executionId}): ${args.message}`);
    return { duplicate: false };
  },
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const health = adminQuery({
  args: {},
  handler: async (ctx) => {
    const [pending, failed, failures, lastFetch, lastManual] = await Promise.all([
      ctx.db
        .query("loanEvents")
        .withIndex("by_status_next", (q) => q.eq("status", "pending"))
        .take(100),
      ctx.db
        .query("loanEvents")
        .withIndex("by_status_next", (q) => q.eq("status", "failed"))
        .take(100),
      ctx.db.query("automationFailures").order("desc").take(20),
      ctx.db
        .query("automationState")
        .withIndex("by_key", (q) => q.eq("key", "overdue_sweep.last_fetch"))
        .unique(),
      ctx.db
        .query("automationState")
        .withIndex("by_key", (q) => q.eq("key", "overdue_sweep.manual_request"))
        .unique(),
    ]);
    const recentEvents = await ctx.db.query("loanEvents").order("desc").take(50);
    const notificationFailures = recentEvents.filter(
      (e) => e.status === "failed" || e.notification?.status === "failed",
    );
    const remindersSent = (await ctx.db.query("reminders").order("desc").take(200)).filter(
      (r) => r.status === "sent" && r.attemptedAt > Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).length;

    const failedRows = [...failed, ...notificationFailures.filter((e) => e.status !== "failed")];
    return {
      pendingDeliveries: pending.length,
      failedNotifications: await Promise.all(
        failedRows.map(async (event) => {
          const loan = await ctx.db.get(event.loanId);
          const tool = loan ? await ctx.db.get(loan.toolId) : null;
          return {
            _id: event._id,
            type: event.type,
            toolName: tool?.name ?? "Removed tool",
            attempts: event.attempts,
            ...notificationState(event),
          };
        }),
      ),
      workflowFailures: failures,
      overdueSweep: {
        lastFetchAt: lastFetch?.at ?? null,
        lastFetchDetail: lastFetch?.detail ?? null,
        stale: !lastFetch || lastFetch.at < Date.now() - SWEEP_STALE_AFTER_MS,
        lastManualRequest: lastManual ? { at: lastManual.at, detail: lastManual.detail ?? null } : null,
      },
      remindersSentLast7Days: remindersSent,
    };
  },
});

/** Admin button: ask n8n to run the overdue-reminder workflow now instead of waiting for 09:00. */
export const requestOverdueSweep = adminMutation({
  args: {},
  handler: async (ctx) => {
    await touchState(ctx, "overdue_sweep.manual_request", "requested");
    await ctx.db.insert("auditLog", {
      actorId: ctx.viewer._id,
      action: "automation.overdue_sweep_requested",
      targetId: "overdue_sweep",
    });
    await ctx.scheduler.runAfter(0, internal.automation.triggerOverdueSweep, {});
  },
});

export const triggerOverdueSweep = internalAction({
  args: {},
  handler: async (ctx) => {
    let detail = "accepted by n8n";
    try {
      const url = process.env.N8N_OVERDUE_SWEEP_WEBHOOK_URL;
      if (!url) throw new Error("N8N_OVERDUE_SWEEP_WEBHOOK_URL is not set");
      const token = await signForN8n({ kind: "overdue_sweep" }, crypto.randomUUID());
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) detail = `n8n answered HTTP ${response.status}`;
    } catch (e) {
      detail = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    await ctx.runMutation(internal.automation.recordManualSweep, { detail });
  },
});

export const recordManualSweep = internalMutation({
  args: { detail: v.string() },
  handler: async (ctx, { detail }) => {
    await touchState(ctx, "overdue_sweep.manual_request", truncate(detail, 200));
  },
});
