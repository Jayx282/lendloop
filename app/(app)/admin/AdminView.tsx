"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ActivityList, LoanStatusBadge } from "@/components/loan-bits";
import { useToast } from "@/components/providers/ToastProvider";
import { useViewer } from "@/components/providers/ViewerProvider";
import { SecurityPanel } from "@/components/SecurityPanel";
import { Badge, Button, Card, EmptyState, PageHeader, PageSpinner, SectionTitle } from "@/components/ui";
import { formatRange, timeAgo } from "@/lib/format";
import { useMutationState } from "@/lib/useMutationState";

type Health = FunctionReturnType<typeof api.automation.health>;

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p
        className={
          tone === "bad"
            ? "mt-1 text-lg font-semibold text-rose-700"
            : tone === "warn"
              ? "mt-1 text-lg font-semibold text-amber-700"
              : "mt-1 text-lg font-semibold text-stone-900"
        }
      >
        {value}
      </p>
    </Card>
  );
}

function RetryButton({ eventId }: { eventId: Id<"loanEvents"> }) {
  const retry = useMutationState(api.notifications.retry);
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="secondary"
      pending={retry.pending}
      onClick={async () => {
        const result = await retry.run({ eventId });
        toast(result.ok ? "Queued for another try" : result.error, result.ok ? "success" : "error");
      }}
    >
      Retry
    </Button>
  );
}

function AutomationHealth({ health }: { health: Health }) {
  const sweep = useMutationState(api.automation.requestOverdueSweep);
  const toast = useToast();
  const failedCount = health.failedNotifications.length + health.workflowFailures.length;

  return (
    <section aria-labelledby="automation-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="automation-heading" className="text-lg font-semibold">
          Automation (n8n)
        </h2>
        <Button
          size="sm"
          variant="secondary"
          pending={sweep.pending}
          onClick={async () => {
            const result = await sweep.run({});
            toast(result.ok ? "Asked n8n to run the overdue check" : result.error, result.ok ? "success" : "error");
          }}
        >
          Run overdue check now
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Overdue check last ran"
          value={health.overdueSweep.lastFetchAt ? timeAgo(health.overdueSweep.lastFetchAt) : "never"}
          tone={health.overdueSweep.stale ? "warn" : undefined}
        />
        <Stat label="Reminders sent (7 days)" value={String(health.remindersSentLast7Days)} />
        <Stat label="Notifications in flight" value={String(health.pendingDeliveries)} />
        <Stat label="Failures" value={String(failedCount)} tone={failedCount > 0 ? "bad" : undefined} />
      </div>
      {health.overdueSweep.stale && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The daily overdue workflow hasn&apos;t fetched loans in over 26 hours. Check that n8n is running and the
          workflow is published.
        </p>
      )}
      {health.overdueSweep.lastFetchDetail && (
        <p className="mt-2 text-xs text-stone-500">Last check: {health.overdueSweep.lastFetchDetail}.</p>
      )}
      {health.overdueSweep.lastManualRequest && (
        <p className="mt-1 text-xs text-stone-500">
          Manual run requested {timeAgo(health.overdueSweep.lastManualRequest.at)}:{" "}
          {health.overdueSweep.lastManualRequest.detail}.
        </p>
      )}

      {health.failedNotifications.length > 0 && (
        <>
          <SectionTitle count={health.failedNotifications.length}>Failed notifications</SectionTitle>
          <div className="space-y-2">
            {health.failedNotifications.map((event) => (
              <Card key={event._id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <p className="font-medium">
                    {event.type} · {event.toolName}
                  </p>
                  <p className="text-stone-600">
                    {event.attempts} attempt{event.attempts === 1 ? "" : "s"} · {event.error ?? "no error message"} ·{" "}
                    {timeAgo(event.at)}
                  </p>
                </div>
                <RetryButton eventId={event._id} />
              </Card>
            ))}
          </div>
        </>
      )}
      {health.workflowFailures.length > 0 && (
        <>
          <SectionTitle count={health.workflowFailures.length}>Failed n8n runs</SectionTitle>
          <div className="space-y-2">
            {health.workflowFailures.map((failure) => (
              <Card key={failure._id} className="text-sm">
                <p className="font-medium">
                  {failure.workflowName}
                  {failure.node && <span className="font-normal text-stone-500"> at “{failure.node}”</span>}
                </p>
                <p className="text-stone-600">
                  {failure.message} · execution {failure.executionId} · {timeAgo(failure.occurredAt)}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TrustToggle({ userId, trusted }: { userId: Id<"users">; trusted: boolean }) {
  const setTrusted = useMutationState(api.users.setTrustedLender);
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant={trusted ? "secondary" : "primary"}
      pending={setTrusted.pending}
      onClick={async () => {
        const result = await setTrusted.run({ userId, trusted: !trusted });
        if (!result.ok) toast(result.error, "error");
      }}
    >
      {trusted ? "Remove badge" : "Mark Trusted Lender"}
    </Button>
  );
}

export function AdminView() {
  const viewer = useViewer();
  const isAdmin = viewer.role === "admin";
  // Skip the admin-only queries for everyone else; Convex would reject them anyway.
  const health = useQuery(api.automation.health, isAdmin ? {} : "skip");
  const loans = useQuery(api.loans.all, isAdmin ? {} : "skip");
  const users = useQuery(api.users.list, isAdmin ? {} : "skip");
  const security = useQuery(api.security.status, isAdmin ? {} : "skip");

  if (!isAdmin) {
    return <EmptyState title="Admins only">This page is for LendLoop admins.</EmptyState>;
  }
  if (!health || !loans || !users || !security) return <PageSpinner label="Loading admin data" />;

  return (
    <>
      <PageHeader
        title="Admin"
        description="Automation health, data protection, every loan, and Trusted Lender badges. To remove a listing, use Browse."
      />
      <AutomationHealth health={health} />
      <SecurityPanel status={security} />

      <SectionTitle count={loans.length}>All loans</SectionTitle>
      {loans.length === 0 ? (
        <EmptyState title="No loans yet" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {loans.map((loan) => (
            <Card key={loan._id}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold">{loan.tool.name}</h3>
                <LoanStatusBadge status={loan.status} overdue={loan.overdue} />
              </div>
              <p className="mt-1 text-sm text-stone-600">
                {loan.lender.displayName} → {loan.borrower.displayName} · {formatRange(loan.startDate, loan.endDate)}
              </p>
              <ActivityList items={loan.activity} limit={4} />
            </Card>
          ))}
        </div>
      )}

      <SectionTitle count={users.length}>Neighbours</SectionTitle>
      <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="hidden px-4 py-2 font-medium sm:table-cell">Listings</th>
              <th className="px-4 py-2 font-medium">Trusted Lender</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {users.map((user) => (
              <tr key={user._id}>
                <td className="px-4 py-2.5">
                  {user.displayName}
                  {user._id === viewer._id && <span className="text-stone-500"> (you)</span>}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={user.role === "admin" ? "violet" : "neutral"}>{user.role}</Badge>
                </td>
                <td className="hidden px-4 py-2.5 sm:table-cell">{user.activeListings}</td>
                <td className="px-4 py-2.5">
                  <TrustToggle userId={user._id} trusted={user.trustedLender} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
