"use client";

import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import type { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/convex/lib/constants";
import { ActivityList, LoanStatusBadge } from "@/components/loan-bits";
import { Card, ErrorText, TrustedBadge } from "@/components/ui";
import { formatRange, loanDays } from "@/lib/format";

export type LoanView = FunctionReturnType<typeof api.loans.myRequests>[number];

export function LoanCard({
  loan,
  perspective,
  actions,
  error,
}: {
  loan: LoanView;
  perspective: "borrower" | "lender";
  actions?: ReactNode;
  error?: string | null;
}) {
  const days = loanDays(loan.startDate, loan.endDate);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{loan.tool.name}</h3>
            <LoanStatusBadge status={loan.status} overdue={loan.overdue} />
            {loan.tool.removed && <span className="text-xs text-stone-500">(listing removed)</span>}
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {formatRange(loan.startDate, loan.endDate)} · {days} day{days === 1 ? "" : "s"}
            {loan.tool.category && ` · ${categoryLabel(loan.tool.category)}`}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-stone-600">
            {perspective === "borrower" ? (
              <>
                From {loan.lender.displayName}
                {loan.lender.trustedLender && <TrustedBadge />}
              </>
            ) : (
              <>Requested by {loan.borrower.displayName}</>
            )}
          </p>
          {loan.overdue && (
            <p className="mt-1 text-sm font-medium text-rose-700">
              {loan.daysOverdue} day{loan.daysOverdue === 1 ? "" : "s"} overdue
            </p>
          )}
          {loan.note && <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">“{loan.note}”</p>}
          {loan.closedReason && <p className="mt-2 text-sm text-stone-500">{loan.closedReason}</p>}
          {loan.contactEmail && (
            <p className="mt-2 text-sm text-stone-700">
              Arrange the hand-over:{" "}
              <a className="font-medium text-emerald-700 hover:underline" href={`mailto:${loan.contactEmail}`}>
                {loan.contactEmail}
              </a>
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      {error && (
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      <ActivityList items={loan.activity} />
    </Card>
  );
}
