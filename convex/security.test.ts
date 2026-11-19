import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { day, setup, signedIn, TEST_DATA_KEY, TEST_DATA_KEY_2 } from "./test.setup";

// Field-level encryption of emails, and the hash-chained audit log.

beforeEach(() => {
  vi.useFakeTimers(); // hold back scheduled notification deliveries
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function world() {
  const { t, as } = setup();
  const lender = await signedIn(as("lender", "Asha Kumar"));
  const borrower = await signedIn(as("borrower", "Ravi Mehta"));
  const admin = await signedIn(as("admin", "Admin Person"));
  await t.mutation(internal.users.setRole, { email: "admin@example.com", role: "admin" });
  const toolId = await lender.user.mutation(api.tools.create, {
    name: "Ladder",
    category: "other",
    condition: "good",
    description: "",
  });
  return { t, lender, borrower, admin, toolId };
}

async function approvedLoan() {
  const w = await world();
  const loanId = await w.borrower.user.mutation(api.loans.request, {
    toolId: w.toolId,
    startDate: day(0),
    endDate: day(1),
  });
  await w.lender.user.mutation(api.loans.approve, { loanId });
  return { ...w, loanId };
}

describe("encrypted emails", () => {
  test("only ciphertext is stored, and it decrypts where it's needed", async () => {
    const { t, lender } = await approvedLoan();
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(JSON.stringify(users)).not.toContain("@example.com");
    expect(users.every((u) => u.emailCiphertext?.startsWith("v1.") && u.emailHash)).toBe(true);

    // The lender of an approved loan still sees the borrower's address.
    const [loan] = await lender.user.query(api.loans.incoming, {});
    expect(loan.contactEmail).toBe("borrower@example.com");
  });

  test("a ciphertext copied into another user's row doesn't decrypt there", async () => {
    const { t, lender, borrower, admin } = await approvedLoan();
    const adminRow = await t.run((ctx) => ctx.db.get(admin.id));
    await t.run((ctx) => ctx.db.patch(borrower.id, { emailCiphertext: adminRow!.emailCiphertext }));

    const [loan] = await lender.user.query(api.loans.incoming, {});
    expect(loan.contactEmail).toBeUndefined();
  });

  test("make-admin finds the user through the blind index, whatever the case", async () => {
    const { t } = await world();
    const result = await t.mutation(internal.users.setRole, { email: "  BORROWER@Example.COM ", role: "admin" });
    expect(result.displayName).toBe("Ravi M.");
  });

  test("key rotation: old rows stay readable, then move to the new key", async () => {
    const { t, lender, admin } = await approvedLoan();
    const status = () => admin.user.query(api.security.status, {});
    const firstKey = (await status()).encryption.keyId;

    vi.stubEnv("LENDLOOP_DATA_KEY", TEST_DATA_KEY_2);
    vi.stubEnv("LENDLOOP_DATA_KEY_PREVIOUS", TEST_DATA_KEY);
    expect((await status()).encryption).toMatchObject({ withEmail: 3, onOlderKey: 3 });
    expect((await lender.user.query(api.loans.incoming, {}))[0].contactEmail).toBe("borrower@example.com");

    expect(await t.mutation(internal.security.reencryptEmails, {})).toEqual({
      reencrypted: 3,
      remaining: 0,
      unknownKey: 0,
    });
    const after = await status();
    expect(after.encryption.onOlderKey).toBe(0);
    expect(after.encryption.keyId).not.toBe(firstKey);
    expect(after.entries[0]).toMatchObject({ action: "security.emails_reencrypted", actor: "CLI (deployment key)" });

    // The old key can now be removed.
    vi.stubEnv("LENDLOOP_DATA_KEY_PREVIOUS", "");
    expect((await lender.user.query(api.loans.incoming, {}))[0].contactEmail).toBe("borrower@example.com");
    expect((await t.mutation(internal.users.setRole, { email: "lender@example.com", role: "user" })).role).toBe("user");
  });

  test("without a data key, nothing is stored in plaintext: sign-up fails closed", async () => {
    vi.stubEnv("LENDLOOP_DATA_KEY", "");
    const { as } = setup();
    await expect(signedIn(as("u9", "No Key"))).rejects.toThrow();
  });
});

describe("audit trail", () => {
  async function withHistory() {
    const w = await world(); // the CLI setRole above is entry #1
    await w.admin.user.mutation(api.users.setTrustedLender, { userId: w.lender.id, trusted: true });
    await w.admin.user.mutation(api.users.setTrustedLender, { userId: w.lender.id, trusted: false });
    await w.admin.user.mutation(api.tools.remove, { toolId: w.toolId });
    return w;
  }

  test("entries form a verifiable hash chain", async () => {
    const { t, admin } = await withHistory();
    const { chain, entries } = await admin.user.query(api.security.status, {});
    expect(chain).toMatchObject({ ok: true, entries: 4, headSeq: 4 });
    expect(entries.map((e) => [e.seq, e.action, e.actor])).toEqual([
      [4, "tool.removed_by_admin", "Admin P."],
      [3, "user.trusted_lender_set", "Admin P."],
      [2, "user.trusted_lender_set", "Admin P."],
      [1, "user.role_set", "CLI (deployment key)"],
    ]);
    const rows = await t.run((ctx) => ctx.db.query("auditLog").withIndex("by_seq").collect());
    rows.slice(1).forEach((row, i) => expect(row.prevHash).toBe(rows[i].hash));
  });

  test("editing a past entry is detected", async () => {
    const { t, admin } = await withHistory();
    await t.run(async (ctx) => {
      const entry = await ctx.db
        .query("auditLog")
        .withIndex("by_seq", (q) => q.eq("seq", 2))
        .unique();
      await ctx.db.patch(entry!._id, { detail: "Asha K.: nothing to see here" });
    });
    const { chain } = await admin.user.query(api.security.status, {});
    expect(chain).toMatchObject({ ok: false, brokenAt: 2, reason: "its content was changed" });
  });

  test("deleting a past entry is detected", async () => {
    const { t, admin } = await withHistory();
    await t.run(async (ctx) => {
      const entry = await ctx.db
        .query("auditLog")
        .withIndex("by_seq", (q) => q.eq("seq", 3))
        .unique();
      await ctx.db.delete(entry!._id);
    });
    const { chain } = await admin.user.query(api.security.status, {});
    expect(chain).toMatchObject({ ok: false, brokenAt: 3, reason: "entry #3 is missing" });
  });

  test("rewriting an entry and its hash still breaks the link to the next entry", async () => {
    const { t, admin } = await withHistory();
    await t.run(async (ctx) => {
      const entry = await ctx.db
        .query("auditLog")
        .withIndex("by_seq", (q) => q.eq("seq", 2))
        .unique();
      await ctx.db.patch(entry!._id, { detail: "forged", hash: "recomputed-by-an-attacker" });
    });
    const { chain } = await admin.user.query(api.security.status, {});
    expect(chain).toMatchObject({ ok: false, brokenAt: 2 });
  });

  test("only admins can see the security status", async () => {
    const { borrower } = await world();
    await expect(borrower.user.query(api.security.status, {})).rejects.toThrow(/Only admins/);
  });
});
