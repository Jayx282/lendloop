import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { adminMutation } from "./functions";
import { fail } from "./lib/auth";
import type { LoanEventType } from "./lib/constants";
import { signForN8n } from "./lib/jwt";
import { truncate } from "./lib/text";

// Convex -> n8n loan events, delivered with a transactional outbox:
// 1. A loan mutation calls enqueueLoanEvent, which writes a `loanEvents` row and
//    schedules `deliver` in the same transaction. If the mutation rolls back, no event exists.
// 2. `deliver` signs the event and POSTs it to the n8n webhook.
// 3. Failures are retried with backoff; after the last attempt the event is marked
//    `failed` and shows up on the admin page, where it can be retried by hand.
// 4. A cron re-queues events whose scheduled retry never ran.

const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const REQUEST_TIMEOUT_MS = 10_000;
const STALE_AFTER_MS = 10 * 60_000;

export const RECIPIENT_ROLE: Record<LoanEventType, "lender" | "borrower"> = {
  "loan.requested": "lender",
  "loan.cancelled": "lender",
  "loan.approved": "borrower",
  "loan.declined": "borrower",
  "loan.returned": "borrower",
};

export async function enqueueLoanEvent(
  ctx: MutationCtx,
  loanId: Id<"loans">,
  type: LoanEventType,
): Promise<Id<"loanEvents">> {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw new Error(`enqueueLoanEvent: loan ${loanId} not found`);
  const recipientId = RECIPIENT_ROLE[type] === "lender" ? loan.lenderId : loan.borrowerId;
  const eventId = await ctx.db.insert("loanEvents", {
    loanId,
    type,
    recipientId,
    status: "pending",
    attempts: 0,
    nextAttemptAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
  return eventId;
}

/** Builds the smallest payload the notification needs: first name + email of the recipient, no IDs. */
export const prepareDelivery = internalQuery({
  args: { eventId: v.id("loanEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return { kind: "done" as const };

    const loan = await ctx.db.get(event.loanId);
    const tool = loan ? await ctx.db.get(loan.toolId) : null;
    const recipient = await ctx.db.get(event.recipientId);
    if (!loan || !tool || !recipient) return { kind: "skip" as const, reason: "Loan data no longer exists." };
    if (!recipient.email) return { kind: "skip" as const, reason: "Recipient has no email address on file." };

    const role = RECIPIENT_ROLE[event.type];
    const counterpart = await ctx.db.get(role === "lender" ? loan.borrowerId : loan.lenderId);
    const appUrl = (process.env.LENDLOOP_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return {
      kind: "send" as const,
      payload: {
        type: event.type,
        recipient: { name: recipient.displayName, email: recipient.email, role },
        counterpart: { name: counterpart?.displayName ?? "A neighbour" },
        tool: { name: tool.name },
        loan: {
          startDate: loan.startDate,
          endDate: loan.endDate,
          ...(loan.closedReason ? { reason: loan.closedReason } : {}),
        },
        link: `${appUrl}/${role === "lender" ? "incoming" : "requests"}`,
      },
    };
  },
});

export const deliver = internalAction({
  args: { eventId: v.id("loanEvents") },
  handler: async (ctx, { eventId }) => {
    const prepared = await ctx.runQuery(internal.notifications.prepareDelivery, { eventId });
    if (prepared.kind === "done") return;
    if (prepared.kind === "skip") {
      await ctx.runMutation(internal.notifications.recordSkipped, { eventId, reason: prepared.reason });
      return;
    }

    let error: string | undefined;
    try {
      const url = process.env.N8N_LOAN_EVENTS_WEBHOOK_URL;
      if (!url) throw new Error("N8N_LOAN_EVENTS_WEBHOOK_URL is not set");
      const token = await signForN8n({ kind: "loan_event", event: prepared.payload }, eventId);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        // The body is empty on purpose: n8n acts only on the verified token claims.
        const response = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: "{}",
          signal: controller.signal,
        });
        if (!response.ok) error = `n8n answered HTTP ${response.status}`;
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await ctx.runMutation(internal.notifications.recordAttempt, { eventId, error });
  },
});

export const recordAttempt = internalMutation({
  args: { eventId: v.id("loanEvents"), error: v.optional(v.string()) },
  handler: async (ctx, { eventId, error }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return;
    const attempts = event.attempts + 1;

    if (error === undefined) {
      await ctx.db.patch(eventId, {
        status: "delivered",
        attempts,
        deliveredAt: Date.now(),
        nextAttemptAt: undefined,
        lastError: undefined,
      });
      return;
    }

    const delay = RETRY_DELAYS_MS[attempts - 1];
    if (delay === undefined) {
      await ctx.db.patch(eventId, {
        status: "failed",
        attempts,
        nextAttemptAt: undefined,
        lastError: truncate(error),
      });
      console.error(`Loan event ${eventId} failed after ${attempts} attempts: ${error}`);
      return;
    }
    await ctx.db.patch(eventId, { attempts, nextAttemptAt: Date.now() + delay, lastError: truncate(error) });
    await ctx.scheduler.runAfter(delay, internal.notifications.deliver, { eventId });
  },
});

export const recordSkipped = internalMutation({
  args: { eventId: v.id("loanEvents"), reason: v.string() },
  handler: async (ctx, { eventId, reason }) => {
    const event = await ctx.db.get(eventId);
    if (!event || event.status !== "pending") return;
    await ctx.db.patch(eventId, { status: "skipped", nextAttemptAt: undefined, lastError: reason });
  },
});

/** Written back by n8n after it sent (or failed to send) the notification. Idempotent. */
export const recordReceipt = internalMutation({
  args: {
    eventId: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    channel: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const eventId = ctx.db.normalizeId("loanEvents", args.eventId);
    const event = eventId ? await ctx.db.get(eventId) : null;
    if (!eventId || !event) return { found: false, duplicate: false };
    if (event.notification?.status === "sent") return { found: true, duplicate: true };

    await ctx.db.patch(eventId, {
      // A receipt proves n8n got the event, even if our delivery attempt timed out.
      status: "delivered",
      deliveredAt: event.deliveredAt ?? Date.now(),
      nextAttemptAt: undefined,
      notification: {
        status: args.status,
        channel: truncate(args.channel, 40),
        at: Date.now(),
        ...(args.error ? { error: truncate(args.error) } : {}),
      },
    });
    return { found: true, duplicate: false };
  },
});

/** Safety net, run by a cron: re-queue pending events whose scheduled retry never ran. */
export const redeliverStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db
      .query("loanEvents")
      .withIndex("by_status_next", (q) => q.eq("status", "pending").lt("nextAttemptAt", Date.now() - STALE_AFTER_MS))
      .take(50);
    for (const event of stale) {
      await ctx.db.patch(event._id, { nextAttemptAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId: event._id });
    }
    if (stale.length > 0) console.warn(`Re-queued ${stale.length} stale loan event(s)`);
  },
});

/** Admin: send a failed notification again (same event ID, so n8n still dedupes). */
export const retry = adminMutation({
  args: { eventId: v.id("loanEvents") },
  handler: async (ctx, { eventId }) => {
    const event = await ctx.db.get(eventId);
    if (!event) fail("Event not found.", "NOT_FOUND");
    const failed = event.status === "failed" || event.notification?.status === "failed";
    if (!failed) fail("Only failed notifications can be retried.");
    await ctx.db.patch(eventId, {
      status: "pending",
      attempts: 0,
      nextAttemptAt: Date.now(),
      lastError: undefined,
      notification: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.notifications.deliver, { eventId });
    await ctx.db.insert("auditLog", {
      actorId: ctx.viewer._id,
      action: "loan_event.retried",
      targetId: eventId,
    });
  },
});
