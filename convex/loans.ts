import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { adminQuery, userMutation, userQuery } from "./functions";
import { fail, type Viewer } from "./lib/auth";
import { loanActivity } from "./lib/activity";
import { approvedLoans } from "./lib/availability";
import { LIMITS } from "./lib/constants";
import { addDays, daysBetween, isIsoDay, rangesOverlap, todayUtc } from "./lib/dates";
import { cleanText } from "./lib/text";
import { enqueueLoanEvent } from "./notifications";

// Loan lifecycle. Every rule is checked here, server-side:
//   borrower: request (not their own tool), cancel (before the loan starts)
//   lender:   approve / decline pending requests on their tools, mark approved loans returned
//   admin:    read-only view of all loans (see `all`)
// Loans the caller is not a party to are reported as "not found", so IDs can't be probed.

function validateDates(startDate: string, endDate: string, today: string) {
  if (!isIsoDay(startDate) || !isIsoDay(endDate)) fail("Pick a valid start and end date.");
  // One day of slack: "today" is UTC, and it is already tomorrow east of UTC.
  if (startDate < addDays(today, -1)) fail("The start date can't be in the past.");
  if (endDate < startDate) fail("The return date must be on or after the start date.");
  if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
    fail(`A loan can last at most ${LIMITS.maxLoanDays} days.`);
  }
  if (daysBetween(today, startDate) > LIMITS.maxDaysAhead) {
    fail(`Requests can start at most ${LIMITS.maxDaysAhead} days ahead.`);
  }
}

async function loanAsLender(ctx: QueryCtx, viewer: Viewer, loanId: Id<"loans">): Promise<Doc<"loans">> {
  const loan = await ctx.db.get(loanId);
  if (!loan || loan.lenderId !== viewer._id) fail("Request not found.", "NOT_FOUND");
  return loan;
}

async function loanAsBorrower(ctx: QueryCtx, viewer: Viewer, loanId: Id<"loans">): Promise<Doc<"loans">> {
  const loan = await ctx.db.get(loanId);
  if (!loan || loan.borrowerId !== viewer._id) fail("Request not found.", "NOT_FOUND");
  return loan;
}

async function setStatus(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  status: "approved" | "declined" | "cancelled" | "returned",
  extra: Partial<Doc<"loans">> = {},
) {
  const now = Date.now();
  await ctx.db.patch(loan._id, {
    status,
    ...(status === "returned" ? { returnedAt: now } : { decidedAt: now }),
    ...extra,
  });
  await enqueueLoanEvent(ctx, loan._id, `loan.${status}` as const);
}

export const request = userMutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.removedAt !== undefined) fail("This tool is no longer listed.", "NOT_FOUND");
    if (tool.ownerId === ctx.viewer._id) fail("You can't borrow your own tool.");

    const today = todayUtc();
    validateDates(args.startDate, args.endDate, today);
    const note = args.note?.trim() ? cleanText(args.note, "Note", { max: LIMITS.note.max }) : undefined;

    const myLoans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", ctx.viewer._id))
      .collect();
    const open = myLoans.filter((l) => l.status === "requested" || l.status === "approved");
    if (open.some((l) => l.toolId === tool._id)) {
      fail("You already have an open request for this tool.");
    }
    if (open.filter((l) => l.status === "requested").length >= LIMITS.openRequestsPerBorrower) {
      fail("You have too many pending requests. Wait for answers or cancel some first.", "LIMIT");
    }
    const range = { startDate: args.startDate, endDate: args.endDate };
    if ((await approvedLoans(ctx, tool._id)).some((l) => rangesOverlap(l, range))) {
      fail("Those dates overlap an approved loan. Try other dates.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      lenderId: tool.ownerId,
      borrowerId: ctx.viewer._id,
      ...range,
      note,
      status: "requested",
    });
    await enqueueLoanEvent(ctx, loanId, "loan.requested");
    return loanId;
  },
});

export const approve = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await loanAsLender(ctx, ctx.viewer, loanId);
    if (loan.status !== "requested") fail("Only pending requests can be approved.");
    const tool = await ctx.db.get(loan.toolId);
    if (!tool || tool.removedAt !== undefined) fail("This listing was removed.");
    if (loan.endDate < todayUtc()) fail("These dates have already passed. Decline the request instead.");

    const approved = await approvedLoans(ctx, loan.toolId);
    if (approved.some((other) => rangesOverlap(other, loan))) {
      fail("Those dates overlap a loan you already approved.");
    }
    await setStatus(ctx, loan, "approved");

    // Other pending requests for overlapping dates can no longer be granted.
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_status", (q) => q.eq("toolId", loan.toolId).eq("status", "requested"))
      .collect();
    for (const other of pending) {
      if (other._id !== loan._id && rangesOverlap(other, loan)) {
        await setStatus(ctx, other, "declined", { closedReason: "Those dates went to another neighbour." });
      }
    }
  },
});

export const decline = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await loanAsLender(ctx, ctx.viewer, loanId);
    if (loan.status !== "requested") fail("Only pending requests can be declined.");
    await setStatus(ctx, loan, "declined");
  },
});

export const cancel = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await loanAsBorrower(ctx, ctx.viewer, loanId);
    const notStarted = loan.startDate > todayUtc();
    if (!(loan.status === "requested" || (loan.status === "approved" && notStarted))) {
      fail("Only pending requests, or approved loans that haven't started, can be cancelled.");
    }
    await setStatus(ctx, loan, "cancelled");
  },
});

/** The lender confirms they have the tool back. */
export const markReturned = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await loanAsLender(ctx, ctx.viewer, loanId);
    if (loan.status !== "approved") fail("Only approved loans can be marked returned.");
    await setStatus(ctx, loan, "returned");
  },
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

async function describeLoan(
  ctx: QueryCtx,
  loan: Doc<"loans">,
  perspective: "borrower" | "lender" | "admin",
  today: string,
) {
  const [tool, lender, borrower] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.lenderId),
    ctx.db.get(loan.borrowerId),
  ]);
  const counterpart = perspective === "borrower" ? lender : borrower;
  // Emails are shared only between the two parties, and only once a loan is approved,
  // so they can arrange the hand-over. Admins never see them.
  const shareContact = perspective !== "admin" && loan.status === "approved";
  return {
    _id: loan._id,
    status: loan.status,
    startDate: loan.startDate,
    endDate: loan.endDate,
    note: loan.note,
    closedReason: loan.closedReason,
    requestedAt: loan._creationTime,
    returnedAt: loan.returnedAt,
    overdue: loan.status === "approved" && loan.endDate < today,
    daysOverdue: loan.status === "approved" && loan.endDate < today ? daysBetween(loan.endDate, today) : 0,
    tool: { name: tool?.name ?? "Removed tool", category: tool?.category, removed: tool?.removedAt !== undefined },
    lender: { displayName: lender?.displayName ?? "Neighbour", trustedLender: lender?.trustedLender ?? false },
    borrower: { displayName: borrower?.displayName ?? "Neighbour" },
    contactEmail: shareContact ? counterpart?.email : undefined,
    activity: await loanActivity(ctx, loan._id, { includeErrors: perspective === "admin" }),
  };
}

export const myRequests = userQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", ctx.viewer._id))
      .order("desc")
      .take(200);
    return await Promise.all(loans.map((loan) => describeLoan(ctx, loan, "borrower", today)));
  },
});

export const incoming = userQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", ctx.viewer._id))
      .order("desc")
      .take(200);
    return await Promise.all(loans.map((loan) => describeLoan(ctx, loan, "lender", today)));
  },
});

export const all = adminQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db.query("loans").order("desc").take(300);
    return await Promise.all(loans.map((loan) => describeLoan(ctx, loan, "admin", today)));
  },
});
