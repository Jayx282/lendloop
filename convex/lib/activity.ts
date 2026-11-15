import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { LoanEventType } from "./constants";

// Automation history shown on each loan ("Reminder sent 2 days ago").

export type ActivityItem =
  | {
      kind: "notification";
      event: LoanEventType;
      to: "lender" | "borrower";
      state: "queued" | "delivered" | "sent" | "failed" | "skipped";
      at: number;
      error?: string;
    }
  | { kind: "reminder"; state: "sending" | "sent" | "failed"; day: string; at: number; error?: string };

export function notificationState(event: Doc<"loanEvents">): ActivityItem & { kind: "notification" } {
  const to = event.type === "loan.requested" || event.type === "loan.cancelled" ? "lender" : "borrower";
  const base = { kind: "notification" as const, event: event.type, to: to as "lender" | "borrower" };
  if (event.notification) {
    return { ...base, state: event.notification.status, at: event.notification.at, error: event.notification.error };
  }
  switch (event.status) {
    case "delivered":
      return { ...base, state: "delivered", at: event.deliveredAt ?? event._creationTime };
    case "failed":
    case "skipped":
      return { ...base, state: event.status, at: event._creationTime, error: event.lastError };
    default:
      return { ...base, state: "queued", at: event._creationTime, error: event.lastError };
  }
}

export async function loanActivity(
  ctx: QueryCtx,
  loanId: Id<"loans">,
  { includeErrors }: { includeErrors: boolean },
): Promise<ActivityItem[]> {
  const [events, reminders] = await Promise.all([
    ctx.db
      .query("loanEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .collect(),
    ctx.db
      .query("reminders")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .collect(),
  ]);
  const items: ActivityItem[] = [
    ...events.map(notificationState),
    ...reminders.map((r): ActivityItem => ({
      kind: "reminder",
      state: r.status,
      day: r.day,
      at: r.attemptedAt,
      error: r.error,
    })),
  ];
  items.sort((a, b) => b.at - a.at);
  // Error details are for admins; neighbours only see that something failed.
  if (includeErrors) return items;
  return items.map((item) => {
    const copy = { ...item };
    delete copy.error;
    return copy;
  });
}
