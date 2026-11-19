import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { sha256 } from "./encoding";

// Tamper-evident audit trail. Every entry stores a SHA-256 hash over its own
// content plus the previous entry's hash, so editing, reordering or deleting any
// past entry breaks the chain from that point on, and `verifyAuditChain` says
// exactly where. Appends can't fork the chain: reading the current head puts it
// in the mutation's read set, so two concurrent appends conflict and Convex
// retries one of them after the other commits.
//
// What a chain can't catch on its own is someone with database access deleting
// the newest entries. That needs the head hash kept somewhere else (see
// docs/production.md); the admin page shows it so it can be noted.

export type AuditAction = Doc<"auditLog">["action"];
export type AuditEntryInput = {
  actorId?: Id<"users">; // absent when run from the CLI with the deployment key
  action: AuditAction;
  targetId: string;
  detail?: string;
};

export const GENESIS_HASH = "genesis";

type HashedFields = AuditEntryInput & { seq: number; prevHash: string; at: number };

export async function auditEntryHash(entry: HashedFields): Promise<string> {
  // Fixed field order, so the same entry always hashes the same way.
  return await sha256(
    JSON.stringify([
      entry.seq,
      entry.prevHash,
      entry.at,
      entry.actorId ?? null,
      entry.action,
      entry.targetId,
      entry.detail ?? null,
    ]),
  );
}

export async function appendAudit(ctx: MutationCtx, entry: AuditEntryInput): Promise<void> {
  const head = await ctx.db.query("auditLog").withIndex("by_seq").order("desc").first();
  const fields: HashedFields = {
    ...entry,
    seq: (head?.seq ?? 0) + 1,
    prevHash: head?.hash ?? GENESIS_HASH,
    at: Date.now(),
  };
  await ctx.db.insert("auditLog", { ...fields, hash: await auditEntryHash(fields) });
}

export type ChainCheck =
  | { ok: true; entries: number; headSeq: number; headHash: string }
  | { ok: false; entries: number; brokenAt: number; reason: string };

/** Recomputes every hash from the first entry. (A long log would check in batches from a trusted checkpoint.) */
export async function verifyAuditChain(ctx: QueryCtx): Promise<ChainCheck> {
  const entries = await ctx.db.query("auditLog").withIndex("by_seq").take(5000);
  let prevHash = GENESIS_HASH;
  for (const [index, entry] of entries.entries()) {
    const expectedSeq = index + 1;
    if (entry.seq !== expectedSeq) {
      return { ok: false, entries: entries.length, brokenAt: expectedSeq, reason: `entry #${expectedSeq} is missing` };
    }
    if (entry.prevHash !== prevHash) {
      return {
        ok: false,
        entries: entries.length,
        brokenAt: entry.seq,
        reason: "it doesn't link to the entry before it",
      };
    }
    const { seq, at, actorId, action, targetId, detail } = entry;
    if ((await auditEntryHash({ seq, prevHash, at, actorId, action, targetId, detail })) !== entry.hash) {
      return { ok: false, entries: entries.length, brokenAt: entry.seq, reason: "its content was changed" };
    }
    prevHash = entry.hash;
  }
  const head = entries.at(-1);
  return { ok: true, entries: entries.length, headSeq: head?.seq ?? 0, headHash: head?.hash ?? GENESIS_HASH };
}
