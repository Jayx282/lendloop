"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { LoanCard, type LoanView } from "@/components/LoanCard";
import { useToast } from "@/components/providers/ToastProvider";
import { Button, EmptyState, PageHeader, PageSpinner, SectionTitle } from "@/components/ui";
import { useMutationState } from "@/lib/useMutationState";

function PendingActions({ loan, onError }: { loan: LoanView; onError: (message: string | null) => void }) {
  const approve = useMutationState(api.loans.approve);
  const decline = useMutationState(api.loans.decline);
  const toast = useToast();
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        pending={decline.pending}
        disabled={approve.pending}
        onClick={async () => {
          onError(null);
          const result = await decline.run({ loanId: loan._id });
          if (result.ok) toast(`Declined. ${loan.borrower.displayName} will be told.`);
          else onError(result.error);
        }}
      >
        Decline
      </Button>
      <Button
        size="sm"
        pending={approve.pending}
        disabled={decline.pending}
        onClick={async () => {
          onError(null);
          const result = await approve.run({ loanId: loan._id });
          if (result.ok) toast(`Approved. ${loan.borrower.displayName} will get an email.`);
          else onError(result.error);
        }}
      >
        Approve
      </Button>
    </>
  );
}

function ReturnedButton({ loan, onError }: { loan: LoanView; onError: (message: string | null) => void }) {
  const markReturned = useMutationState(api.loans.markReturned);
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="secondary"
      pending={markReturned.pending}
      onClick={async () => {
        onError(null);
        const result = await markReturned.run({ loanId: loan._id });
        if (result.ok) toast("Marked as returned");
        else onError(result.error);
      }}
    >
      Mark returned
    </Button>
  );
}

export function IncomingView() {
  const loans = useQuery(api.loans.incoming);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const setError = (id: string) => (message: string | null) => setErrors((e) => ({ ...e, [id]: message }));

  if (loans === undefined) return <PageSpinner label="Loading incoming requests" />;

  const pending = loans.filter((l) => l.status === "requested");
  const out = loans.filter((l) => l.status === "approved");
  const history = loans.filter((l) => l.status !== "approved" && l.status !== "requested");

  return (
    <>
      <PageHeader title="Incoming requests" description="Requests to borrow your tools, and loans you're waiting on." />
      {loans.length === 0 ? (
        <EmptyState title="No requests yet">When a neighbour asks for one of your tools, it shows up here.</EmptyState>
      ) : (
        <>
          <SectionTitle count={pending.length}>Needs your answer</SectionTitle>
          {pending.length === 0 ? (
            <p className="text-sm text-stone-500">You&apos;re all caught up.</p>
          ) : (
            <div className="space-y-3">
              {pending.map((loan) => (
                <LoanCard
                  key={loan._id}
                  loan={loan}
                  perspective="lender"
                  error={errors[loan._id]}
                  actions={<PendingActions loan={loan} onError={setError(loan._id)} />}
                />
              ))}
            </div>
          )}
          {out.length > 0 && (
            <>
              <SectionTitle count={out.length}>Lent out and booked</SectionTitle>
              <div className="space-y-3">
                {out.map((loan) => (
                  <LoanCard
                    key={loan._id}
                    loan={loan}
                    perspective="lender"
                    error={errors[loan._id]}
                    actions={<ReturnedButton loan={loan} onError={setError(loan._id)} />}
                  />
                ))}
              </div>
            </>
          )}
          {history.length > 0 && (
            <>
              <SectionTitle count={history.length}>History</SectionTitle>
              <div className="space-y-3">
                {history.map((loan) => (
                  <LoanCard key={loan._id} loan={loan} perspective="lender" />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
