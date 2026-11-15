import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { day, setup, signedIn } from "./test.setup";

// Role-based access control and loan rules, exercised against the real Convex
// functions (not the UI). Scheduled deliveries are held back by fake timers.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const drill = { name: "Cordless drill", category: "power-tools", condition: "good", description: "18V" } as const;

async function world() {
  const { t, as } = setup();
  const lender = await signedIn(as("lender", "Asha Kumar"));
  const borrower = await signedIn(as("borrower", "Ravi Mehta"));
  const other = await signedIn(as("other", "Meera Shah"));
  const admin = await signedIn(as("admin", "Admin Person"));
  await t.mutation(internal.users.setRole, { email: "admin@example.com", role: "admin" });
  const toolId = await lender.user.mutation(api.tools.create, drill);
  return { t, as, lender, borrower, other, admin, toolId };
}

describe("users", () => {
  test("sync stores a short display name and the verified email from the token", async () => {
    const { t, as } = setup();
    const { id } = await signedIn(as("u1", "Asha Kumar", "Asha@Example.com"));
    const user = await t.run((ctx) => ctx.db.get(id));
    expect(user).toMatchObject({ displayName: "Asha K.", email: "asha@example.com", role: "user" });
  });

  test("sync ignores unverified emails", async () => {
    const { t } = setup();
    const id = await t
      .withIdentity({ subject: "u2", issuer: "https://clerk.test", email: "x@example.com", emailVerified: false })
      .mutation(api.users.sync, {});
    expect((await t.run((ctx) => ctx.db.get(id)))?.email).toBeUndefined();
  });

  test("signed-out callers are rejected", async () => {
    const { t } = setup();
    await expect(t.query(api.tools.browse, {})).rejects.toThrow(/Sign in/);
    await expect(t.mutation(api.tools.create, drill)).rejects.toThrow(/Sign in/);
  });

  test("only admins can list users or set Trusted Lender", async () => {
    const { borrower, admin, lender } = await world();
    await expect(borrower.user.query(api.users.list, {})).rejects.toThrow(/Only admins/);
    await expect(
      borrower.user.mutation(api.users.setTrustedLender, { userId: borrower.id, trusted: true }),
    ).rejects.toThrow(/Only admins/);

    await admin.user.mutation(api.users.setTrustedLender, { userId: lender.id, trusted: true });
    const browse = await borrower.user.query(api.tools.browse, {});
    expect(browse[0].lender).toEqual({ displayName: "Asha K.", trustedLender: true });
  });
});

describe("listings", () => {
  test("the public list shows available tools with name and category only", async () => {
    const { t, lender, borrower, toolId } = await world();
    await lender.user.mutation(api.tools.create, { ...drill, name: "Hedge trimmer", category: "garden" });
    // Put the drill out on loan: it should drop off the public list.
    const loanId = await borrower.user.mutation(api.loans.request, { toolId, startDate: day(0), endDate: day(2) });
    await lender.user.mutation(api.loans.approve, { loanId });

    const list = await t.query(api.tools.listPublic, {});
    expect(list).toEqual([{ name: "Hedge trimmer", category: "garden" }]);
  });

  test("users can edit and delete only their own listings", async () => {
    const { borrower, lender, toolId } = await world();
    await expect(borrower.user.mutation(api.tools.update, { toolId, ...drill, name: "Mine now" })).rejects.toThrow(
      /not found/,
    );
    await expect(borrower.user.mutation(api.tools.remove, { toolId })).rejects.toThrow(/not found/);

    await lender.user.mutation(api.tools.update, { toolId, ...drill, name: "  Drill   v2 " });
    const [mine] = await lender.user.query(api.tools.mine, {});
    expect(mine.name).toBe("Drill v2");
  });

  test("admins can remove any listing, which declines its pending requests", async () => {
    const { t, borrower, admin, toolId } = await world();
    const loanId = await borrower.user.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    await admin.user.mutation(api.tools.remove, { toolId });

    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.status).toBe("declined");
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toContain("tool.removed_by_admin");
  });

  test("admins cannot rewrite someone else's listing", async () => {
    const { admin, toolId } = await world();
    await expect(admin.user.mutation(api.tools.update, { toolId, ...drill, name: "Edited" })).rejects.toThrow(
      /not found/,
    );
  });

  test("an owner can't delete a tool that is out on loan", async () => {
    const { lender, borrower, toolId } = await world();
    const loanId = await borrower.user.mutation(api.loans.request, { toolId, startDate: day(0), endDate: day(1) });
    await lender.user.mutation(api.loans.approve, { loanId });
    await expect(lender.user.mutation(api.tools.remove, { toolId })).rejects.toThrow(/approved loan/);
  });

  test("input is validated server-side", async () => {
    const { lender } = await world();
    await expect(lender.user.mutation(api.tools.create, { ...drill, name: " x " })).rejects.toThrow(/at least 2/);
    await expect(lender.user.mutation(api.tools.create, { ...drill, description: "a".repeat(281) })).rejects.toThrow(
      /at most 280/,
    );
  });
});

describe("loans", () => {
  test("full flow: request, approve, return, with an event queued at every step", async () => {
    const { t, lender, borrower, toolId } = await world();
    const loanId = await borrower.user.mutation(api.loans.request, {
      toolId,
      startDate: day(0),
      endDate: day(3),
      note: "Shelves",
    });
    await lender.user.mutation(api.loans.approve, { loanId });
    await lender.user.mutation(api.loans.markReturned, { loanId });

    const loan = await t.run((ctx) => ctx.db.get(loanId));
    expect(loan?.status).toBe("returned");
    const events = await t.run((ctx) => ctx.db.query("loanEvents").collect());
    expect(events.map((e) => [e.type, e.recipientId])).toEqual([
      ["loan.requested", lender.id],
      ["loan.approved", borrower.id],
      ["loan.returned", borrower.id],
    ]);
  });

  test("only the lender can approve, decline or mark returned", async () => {
    const { borrower, other, admin, toolId } = await world();
    const loanId = await borrower.user.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    for (const caller of [borrower, other, admin]) {
      await expect(caller.user.mutation(api.loans.approve, { loanId })).rejects.toThrow(/not found/);
      await expect(caller.user.mutation(api.loans.decline, { loanId })).rejects.toThrow(/not found/);
      await expect(caller.user.mutation(api.loans.markReturned, { loanId })).rejects.toThrow(/not found/);
    }
  });

  test("only the borrower can cancel their request", async () => {
    const { lender, other, borrower, toolId } = await world();
    const loanId = await borrower.user.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
    await expect(lender.user.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/not found/);
    await expect(other.user.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/not found/);
    await borrower.user.mutation(api.loans.cancel, { loanId });
  });

  test("lenders can't borrow their own tools", async () => {
    const { lender, toolId } = await world();
    await expect(
      lender.user.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) }),
    ).rejects.toThrow(/your own tool/);
  });

  test("approving a request declines overlapping ones and blocks double booking", async () => {
    const { t, lender, borrower, other, toolId } = await world();
    const first = await borrower.user.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(3) });
    const overlapping = await other.user.mutation(api.loans.request, { toolId, startDate: day(2), endDate: day(4) });
    await lender.user.mutation(api.loans.approve, { loanId: first });

    expect((await t.run((ctx) => ctx.db.get(overlapping)))?.status).toBe("declined");
    await expect(
      other.user.mutation(api.loans.request, { toolId, startDate: day(3), endDate: day(5) }),
    ).rejects.toThrow(/overlap/);
  });

  test("date rules are enforced", async () => {
    const { borrower, toolId } = await world();
    const request = (startDate: string, endDate: string) =>
      borrower.user.mutation(api.loans.request, { toolId, startDate, endDate });
    await expect(request(day(-3), day(1))).rejects.toThrow(/past/);
    await expect(request(day(3), day(1))).rejects.toThrow(/on or after/);
    await expect(request(day(1), day(40))).rejects.toThrow(/at most 30 days/);
    await expect(request("2026-02-30", day(1))).rejects.toThrow(/valid/);
  });

  test("contact emails are shared only between the two parties of an approved loan", async () => {
    const { lender, borrower, admin, toolId } = await world();
    const loanId = await borrower.user.mutation(api.loans.request, { toolId, startDate: day(0), endDate: day(1) });
    expect((await lender.user.query(api.loans.incoming, {}))[0].contactEmail).toBeUndefined();

    await lender.user.mutation(api.loans.approve, { loanId });
    expect((await lender.user.query(api.loans.incoming, {}))[0].contactEmail).toBe("borrower@example.com");
    expect((await borrower.user.query(api.loans.myRequests, {}))[0].contactEmail).toBe("lender@example.com");
    expect((await admin.user.query(api.loans.all, {}))[0].contactEmail).toBeUndefined();
  });
});
