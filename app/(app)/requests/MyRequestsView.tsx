"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { LoanCard, type LoanView } from "@/components/LoanCard";
import { useToast } from "@/components/providers/ToastProvider";
import { Button, EmptyState, PageHeader, PageSpinner, SectionTitle } from "@/components/ui";
import { localToday } from "@/lib/format";
import { useMutationState } from "@/lib/useMutationState";

function CancelButton({ loan }: { loan: LoanView }) {
  const cancel = useMutationState(api.loans.cancel);
  const toast = useToast();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="secondary"
        pending={cancel.pending}
        onClick={async () => {
          if ((await cancel.run({ loanId: loan._id })).ok) toast("Request cancelled");
        }}
      >
        {loan.status === "approved" ? "Cancel booking" : "Cancel request"}
      </Button>
      {cancel.error && <span className="max-w-48 text-right text-xs text-rose-700">{cancel.error}</span>}
    </div>
  );
}

export function MyRequestsView() {
  const loans = useQuery(api.loans.myRequests);
  const today = localToday();

  if (loans === undefined) return <PageSpinner label="Loading your requests" />;

  const active = loans.filter((l) => l.status === "approved");
  const pending = loans.filter((l) => l.status === "requested");
  const history = loans.filter((l) => l.status !== "approved" && l.status !== "requested");
  const canCancel = (l: LoanView) => l.status === "requested" || (l.status === "approved" && l.startDate > today);

  return (
    <>
      <PageHeader title="My requests" description="Tools you've asked to borrow." />
      {loans.length === 0 ? (
        <EmptyState title="No requests yet">
          Find something on the{" "}
          <Link className="font-medium text-emerald-700 underline" href="/tools">
            board
          </Link>
          .
        </EmptyState>
      ) : (
        <>
          {active.length > 0 && (
            <>
              <SectionTitle count={active.length}>Borrowing and booked</SectionTitle>
              <div className="space-y-3">
                {active.map((loan) => (
                  <LoanCard
                    key={loan._id}
                    loan={loan}
                    perspective="borrower"
                    actions={canCancel(loan) ? <CancelButton loan={loan} /> : undefined}
                  />
                ))}
              </div>
            </>
          )}
          {pending.length > 0 && (
            <>
              <SectionTitle count={pending.length}>Waiting for an answer</SectionTitle>
              <div className="space-y-3">
                {pending.map((loan) => (
                  <LoanCard key={loan._id} loan={loan} perspective="borrower" actions={<CancelButton loan={loan} />} />
                ))}
              </div>
            </>
          )}
          {history.length > 0 && (
            <>
              <SectionTitle count={history.length}>History</SectionTitle>
              <div className="space-y-3">
                {history.map((loan) => (
                  <LoanCard key={loan._id} loan={loan} perspective="borrower" />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
