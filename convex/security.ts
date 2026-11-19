import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { adminQuery } from "./functions";
import { appendAudit, verifyAuditChain } from "./lib/audit";
import { currentKeyId, keyIdOf, previousKeyId } from "./lib/fieldEncryption";
import { openEmail, sealEmail } from "./lib/personalData";

// Admin view of the data-protection controls, and the key-rotation job.

/** Encryption coverage, live verification of the audit chain, and its latest entries. */
export const status = adminQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").take(5000);
    const keyId = await currentKeyId();
    const withEmail = users.filter((u) => u.emailCiphertext !== undefined);
    const onOlderKey = withEmail.filter((u) => keyIdOf(u.emailCiphertext!) !== keyId).length;

    const recent = await ctx.db.query("auditLog").withIndex("by_seq").order("desc").take(20);
    const entries = await Promise.all(
      recent.map(async (entry) => {
        const actor = entry.actorId ? await ctx.db.get(entry.actorId) : null;
        return {
          seq: entry.seq,
          at: entry.at,
          action: entry.action,
          detail: entry.detail,
          actor: entry.actorId ? (actor?.displayName ?? "Unknown user") : "CLI (deployment key)",
          hash: entry.hash,
        };
      }),
    );

    return {
      encryption: {
        algorithm: "AES-256-GCM, HKDF-SHA256 keys, HMAC-SHA256 blind index",
        keyId,
        users: users.length,
        withEmail: withEmail.length,
        onOlderKey,
      },
      chain: await verifyAuditChain(ctx),
      entries,
    };
  },
});

/**
 * Re-encrypts emails that are still under a rotated-out key, in batches:
 *   1. set LENDLOOP_DATA_KEY_PREVIOUS to the old key and LENDLOOP_DATA_KEY to a new one;
 *   2. run `npx convex run security:reencryptEmails` until `remaining` is 0;
 *   3. remove LENDLOOP_DATA_KEY_PREVIOUS.
 */
export const reencryptEmails = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, { batchSize = 100 }) => {
    const [keyId, previousId] = [await currentKeyId(), await previousKeyId()];
    const stale = (await ctx.db.query("users").take(5000)).filter(
      (u) => u.emailCiphertext !== undefined && keyIdOf(u.emailCiphertext) !== keyId,
    );
    // Only rows under the previous key can be opened; anything else needs its old key back.
    const movable = stale.filter((u) => keyIdOf(u.emailCiphertext!) === previousId);
    let reencrypted = 0;
    for (const user of movable.slice(0, batchSize)) {
      const email = await openEmail(user);
      if (email === undefined) continue; // tampered or corrupt; logged by openEmail
      await ctx.db.patch(user._id, await sealEmail(user.tokenIdentifier, email));
      reencrypted++;
    }
    if (reencrypted > 0) {
      await appendAudit(ctx, {
        action: "security.emails_reencrypted",
        targetId: "users",
        detail: `${reencrypted} email(s) moved to key ${keyId}`,
      });
    }
    return {
      reencrypted,
      remaining: Math.max(0, movable.length - batchSize),
      unknownKey: stale.length - movable.length,
    };
  },
});
