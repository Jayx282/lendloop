import { SignJWT, jwtVerify } from "jose";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { day, setup, signedIn } from "./test.setup";

// The Convex side of the n8n integration: signed outbound webhooks with
// retries, and the signed, idempotent HTTP endpoints n8n calls.

const TO_N8N = "convex-to-n8n-test-secret-0123456789abcdef";
const FROM_N8N = "n8n-to-convex-test-secret-0123456789abcdef";
const enc = (s: string) => new TextEncoder().encode(s);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_TO_N8N_SIGNING_SECRET", TO_N8N);
  vi.stubEnv("N8N_TO_CONVEX_SIGNING_SECRET", FROM_N8N);
  vi.stubEnv("N8N_LOAN_EVENTS_WEBHOOK_URL", "http://n8n.test/webhook/lendloop/loan-events");
  vi.stubEnv("LENDLOOP_APP_URL", "http://app.test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function requestedLoan() {
  const { t, as } = setup();
  const lender = await signedIn(as("lender", "Asha Kumar"));
  const borrower = await signedIn(as("borrower", "Ravi Mehta"));
  const toolId = await lender.user.mutation(api.tools.create, {
    name: "Ladder",
    category: "other",
    condition: "good",
    description: "",
  });
  const loanId = await borrower.user.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(2) });
  return { t, lender, borrower, toolId, loanId };
}

function n8nToken(claims: Record<string, unknown>, opts: { secret?: string; issuer?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(opts.issuer ?? "lendloop-n8n")
    .setAudience("lendloop-convex")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(enc(opts.secret ?? FROM_N8N));
}

describe("Convex -> n8n webhook", () => {
  test("sends a signed, minimal payload and marks the event delivered", async () => {
    const fetchMock = vi.fn(async (...args: [string, RequestInit]) => (void args, new Response("{}", { status: 202 })));
    vi.stubGlobal("fetch", fetchMock);
    const { t } = await requestedLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://n8n.test/webhook/lendloop/loan-events");
    const token = String((init.headers as Record<string, string>).authorization).replace("Bearer ", "");
    const { payload } = await jwtVerify(token, enc(TO_N8N), { issuer: "lendloop-convex", audience: "lendloop-n8n" });

    expect(payload.event).toEqual({
      type: "loan.requested",
      recipient: { name: "Asha K.", email: "lender@example.com", role: "lender" },
      counterpart: { name: "Ravi M." },
      tool: { name: "Ladder" },
      loan: { startDate: day(1), endDate: day(2) },
      link: "http://app.test/incoming",
    });
    const [event] = await t.run((ctx) => ctx.db.query("loanEvents").collect());
    expect(payload.jti).toBe(event._id);
    expect(event).toMatchObject({ status: "delivered", attempts: 1 });
  });

  test("retries with backoff, then gives up and marks the event failed", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const { t } = await requestedLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [event] = await t.run((ctx) => ctx.db.query("loanEvents").collect());
    expect(event).toMatchObject({ status: "failed", attempts: 6, lastError: "n8n answered HTTP 503" });
  });

  test("skips recipients without an email instead of calling n8n", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { t, as } = setup();
    const lender = await signedIn(as("nomail", "No Mail", ""));
    const borrower = await signedIn(as("b", "Bee"));
    const toolId = await lender.user.mutation(api.tools.create, {
      name: "Saw",
      category: "hand-tools",
      condition: "good",
      description: "",
    });
    await borrower.user.mutation(api.loans.request, { toolId, startDate: day(1), endDate: day(1) });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).not.toHaveBeenCalled();
    const [event] = await t.run((ctx) => ctx.db.query("loanEvents").collect());
    expect(event.status).toBe("skipped");
  });
});

describe("n8n -> Convex endpoints", () => {
  test("reject missing, forged, wrong-issuer and wrong-scope tokens", async () => {
    const { t } = await requestedLoan();
    const call = (token?: string) =>
      t.fetch("/n8n/overdue-loans", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });

    expect((await call()).status).toBe(401);
    expect((await call(await n8nToken({ scope: "overdue-loans:claim" }, { secret: TO_N8N }))).status).toBe(401);
    expect((await call(await n8nToken({ scope: "overdue-loans:claim" }, { issuer: "lendloop-convex" }))).status).toBe(
      401,
    );
    expect((await call(await n8nToken({ scope: "reminders:write" }))).status).toBe(401);
    expect((await call(await n8nToken({ scope: "overdue-loans:claim" }))).status).toBe(200);
  });

  async function overdueLoan() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 202 })),
    );
    const world = await requestedLoan();
    await world.lender.user.mutation(api.loans.approve, { loanId: world.loanId });
    // Make the loan overdue: due two days ago.
    await world.t.run((ctx) => ctx.db.patch(world.loanId, { startDate: day(-5), endDate: day(-2) }));
    const claim = async (run: string) => {
      const res = await world.t.fetch("/n8n/overdue-loans", {
        method: "POST",
        headers: { authorization: `Bearer ${await n8nToken({ scope: "overdue-loans:claim", run })}` },
      });
      return (await res.json()) as { count: number; loans: { reminderKey: string; daysOverdue: number }[] };
    };
    return { ...world, claim };
  }

  test("an overlapping run can't claim a reminder another run is sending, until its lease expires", async () => {
    const { t, claim } = await overdueLoan();
    expect((await claim("run-1")).count).toBe(1);
    expect((await claim("run-2")).count).toBe(0); // run-1 holds the lease

    vi.advanceTimersByTime(31 * 60 * 1000); // run-1 died without writing back
    expect((await claim("run-3")).count).toBe(1);
    const [reminder] = await t.run((ctx) => ctx.db.query("reminders").collect());
    expect(reminder).toMatchObject({ status: "sending", executionId: "run-3" });
  });

  test("overdue list + reminder write-back is idempotent and never reminds twice a day", async () => {
    const { t, loanId, claim } = await overdueLoan();
    const list = () => claim("run-1");
    const before = await list();
    expect(before.count).toBe(1);
    expect(before.loans[0]).toMatchObject({ reminderKey: `${loanId}:${day(0)}`, daysOverdue: 2 });
    expect(Object.keys(before.loans[0]).sort()).toEqual([
      "borrower",
      "daysOverdue",
      "dueDate",
      "lender",
      "loanId",
      "reminderKey",
      "tool",
    ]);

    const writeBack = async (status: "sent" | "failed") => {
      const token = await n8nToken({
        scope: "reminders:write",
        reminderKey: before.loans[0].reminderKey,
        loanId,
        status,
        channel: "email",
      });
      const res = await t.fetch("/n8n/reminders", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      return { status: res.status, body: await res.json() };
    };
    expect(await writeBack("sent")).toEqual({ status: 200, body: { ok: true, duplicate: false } });
    expect(await writeBack("sent")).toEqual({ status: 200, body: { ok: true, duplicate: true } });
    expect(await writeBack("failed")).toEqual({ status: 200, body: { ok: true, duplicate: true } });

    const reminders = await t.run((ctx) => ctx.db.query("reminders").collect());
    expect(reminders).toHaveLength(1);
    expect(reminders[0].status).toBe("sent");
    expect((await claim("run-2")).count).toBe(0); // already reminded today, even after the lease
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect((await claim("run-3")).count).toBe(0);
  });

  test("a failed reminder becomes eligible again on the next run", async () => {
    const { loanId, claim, t } = await overdueLoan();
    const [loan] = (await claim("run-1")).loans;
    const token = await n8nToken({
      scope: "reminders:write",
      reminderKey: loan.reminderKey,
      loanId,
      status: "failed",
      channel: "email",
      error: "smtp down",
    });
    await t.fetch("/n8n/reminders", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect((await claim("run-2")).count).toBe(1);
  });

  test("notification receipts and failure reports are idempotent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 202 })),
    );
    const { t } = await requestedLoan();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [event] = await t.run((ctx) => ctx.db.query("loanEvents").collect());

    const post = async (path: string, claims: Record<string, unknown>) => {
      const res = await t.fetch(path, {
        method: "POST",
        headers: { authorization: `Bearer ${await n8nToken(claims)}` },
      });
      return res.json();
    };
    const receipt = { scope: "notification-receipts:write", eventId: event._id, status: "sent", channel: "email" };
    expect(await post("/n8n/notification-receipts", receipt)).toEqual({ found: true, duplicate: false });
    expect(await post("/n8n/notification-receipts", receipt)).toEqual({ found: true, duplicate: true });

    const failure = { scope: "failures:write", executionId: "77", workflowName: "Overdue", message: "boom" };
    expect(await post("/n8n/failures", failure)).toEqual({ duplicate: false });
    expect(await post("/n8n/failures", failure)).toEqual({ duplicate: true });
  });
});
