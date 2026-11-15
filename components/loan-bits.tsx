"use client";

import type { ActivityItem } from "@/convex/lib/activity";
import type { LoanEventType, LoanStatus } from "@/convex/lib/constants";
import { Badge, type BadgeTone } from "@/components/ui";
import { formatDay, timeAgo } from "@/lib/format";

type Availability = { state: "available"; bookedFrom?: string } | { state: "on_loan"; until: string; overdue: boolean };

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  if (availability.state === "on_loan") {
    return availability.overdue ? (
      <Badge tone="red">Overdue since {formatDay(availability.until)}</Badge>
    ) : (
      <Badge tone="amber">On loan until {formatDay(availability.until)}</Badge>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone="green">Available</Badge>
      {availability.bookedFrom && <Badge tone="neutral">Booked from {formatDay(availability.bookedFrom)}</Badge>}
    </span>
  );
}

const STATUS: Record<LoanStatus, { label: string; tone: BadgeTone }> = {
  requested: { label: "Pending", tone: "blue" },
  approved: { label: "Approved", tone: "green" },
  declined: { label: "Declined", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  returned: { label: "Returned", tone: "neutral" },
};

export function LoanStatusBadge({ status, overdue }: { status: LoanStatus; overdue?: boolean }) {
  if (overdue) return <Badge tone="red">Overdue</Badge>;
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

const EVENT_NOUN: Record<LoanEventType, string> = {
  "loan.requested": "the request",
  "loan.approved": "the approval",
  "loan.declined": "the decline",
  "loan.cancelled": "the cancellation",
  "loan.returned": "the return",
};

function describe(item: ActivityItem): { text: string; tone: "ok" | "wait" | "bad" } {
  if (item.kind === "reminder") {
    if (item.state === "sending") return { text: "Overdue reminder being sent", tone: "wait" };
    return item.state === "sent"
      ? { text: "Overdue reminder sent to the borrower", tone: "ok" }
      : { text: "Overdue reminder failed", tone: "bad" };
  }
  const who = item.to === "lender" ? "Lender" : "Borrower";
  const what = EVENT_NOUN[item.event];
  switch (item.state) {
    case "sent":
      return { text: `${who} emailed about ${what}`, tone: "ok" };
    case "delivered":
      return { text: `${who} notification handed to automation`, tone: "wait" };
    case "queued":
      return { text: `${who} notification queued`, tone: "wait" };
    case "skipped":
      return { text: `${who} not notified (no email on file)`, tone: "wait" };
    case "failed":
      return { text: `${who} notification about ${what} failed`, tone: "bad" };
  }
}

const DOT = { ok: "bg-emerald-500", wait: "bg-stone-400", bad: "bg-rose-500" } as const;

/** Recent automation activity on a loan, e.g. "Overdue reminder sent · 2 days ago". */
export function ActivityList({ items, limit = 3 }: { items: ActivityItem[]; limit?: number }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 border-t border-stone-100 pt-3" aria-label="Automation activity">
      {items.slice(0, limit).map((item, index) => {
        const { text, tone } = describe(item);
        return (
          <li key={index} className="flex items-start gap-2 text-xs text-stone-600">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
            <span>
              {text} · <time dateTime={new Date(item.at).toISOString()}>{timeAgo(item.at)}</time>
              {item.error && <span className="text-rose-600"> ({item.error})</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
