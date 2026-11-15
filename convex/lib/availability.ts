import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type Availability =
  | { state: "available"; bookedFrom?: string } // free today; `bookedFrom` = next approved loan
  | { state: "on_loan"; until: string; overdue: boolean };

export async function approvedLoans(ctx: QueryCtx, toolId: Id<"tools">): Promise<Doc<"loans">[]> {
  return await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

export async function availabilityOf(ctx: QueryCtx, toolId: Id<"tools">, today: string): Promise<Availability> {
  const approved = await approvedLoans(ctx, toolId);
  // An approved loan stays "approved" until the lender marks it returned,
  // so a started one means the tool is out (and overdue once past its end date).
  const current = approved.find((loan) => loan.startDate <= today);
  if (current) {
    return { state: "on_loan", until: current.endDate, overdue: current.endDate < today };
  }
  const next = approved.map((loan) => loan.startDate).sort()[0];
  return next ? { state: "available", bookedFrom: next } : { state: "available" };
}
