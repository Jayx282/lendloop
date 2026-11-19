import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  categoryValidator,
  conditionValidator,
  loanEventTypeValidator,
  loanStatusValidator,
  roleValidator,
} from "./lib/constants";

export default defineSchema({
  // One row per Clerk user, created on first sign-in from the verified token.
  // Data minimization: no full name, phone, avatar or Clerk profile copy.
  users: defineTable({
    tokenIdentifier: v.string(), // "<issuer>|<subject>" from the verified Clerk token
    displayName: v.string(), // what neighbours see, e.g. "Asha K."
    // The verified email, used only to notify this user and shared only with the other
    // party of an approved loan. Never stored in plaintext (lib/fieldEncryption.ts):
    emailCiphertext: v.optional(v.string()), // AES-256-GCM, bound to this row
    emailHash: v.optional(v.string()), // HMAC blind index, for exact-match lookups
    role: roleValidator, // changed only by an internal function (CLI) or by another admin
    trustedLender: v.boolean(),
    trustedLenderSince: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email_hash", ["emailHash"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    // Soft delete keeps loan history intact; removed tools are never listed.
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_removed_category", ["removedAt", "category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"), // denormalized from the tool so access checks need one read
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD, inclusive
    endDate: v.string(), // YYYY-MM-DD, inclusive: the day the tool is due back
    note: v.optional(v.string()),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    closedReason: v.optional(v.string()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status_end", ["status", "endDate"]),

  // Transactional outbox for Convex -> n8n loan events. A row is written in the
  // same transaction as the status change, then an action delivers it with retries.
  loanEvents: defineTable({
    loanId: v.id("loans"),
    type: loanEventTypeValidator,
    recipientId: v.id("users"),
    status: v.union(
      v.literal("pending"), // waiting for (re)delivery to n8n
      v.literal("delivered"), // n8n accepted it (2xx)
      v.literal("failed"), // gave up after the last retry; visible to admins
      v.literal("skipped"), // nothing to send, e.g. no email on file
    ),
    attempts: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    // Written back by n8n once the notification itself went out (or failed).
    notification: v.optional(
      v.object({
        status: v.union(v.literal("sent"), v.literal("failed")),
        channel: v.string(),
        at: v.number(),
        error: v.optional(v.string()),
      }),
    ),
  })
    .index("by_loan", ["loanId"])
    .index("by_status_next", ["status", "nextAttemptAt"]),

  // Overdue reminders. `reminderKey` = "<loanId>:<YYYY-MM-DD>" means one reminder per
  // loan per day: n8n claims it when it fetches the list ("sending", with a lease) and
  // writes back "sent" or "failed". "sent" is final, so retries never add a second one.
  reminders: defineTable({
    reminderKey: v.string(),
    loanId: v.id("loans"),
    day: v.string(),
    status: v.union(v.literal("sending"), v.literal("sent"), v.literal("failed")),
    channel: v.string(),
    error: v.optional(v.string()),
    attemptedAt: v.number(), // claim time while "sending", otherwise the write-back time
    executionId: v.optional(v.string()), // n8n execution that claimed or wrote it
  })
    .index("by_key", ["reminderKey"])
    .index("by_loan", ["loanId"]),

  // Failed n8n executions, reported by the n8n error workflow (idempotent by executionId).
  automationFailures: defineTable({
    executionId: v.string(),
    workflowName: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    occurredAt: v.number(),
  }).index("by_execution", ["executionId"]),

  // Small key/value table for automation health, e.g. when n8n last fetched overdue loans.
  automationState: defineTable({
    key: v.string(),
    at: v.number(),
    detail: v.optional(v.string()),
  }).index("by_key", ["key"]),

  // Append-only, hash-chained record of privileged actions (lib/audit.ts).
  auditLog: defineTable({
    seq: v.number(), // 1, 2, 3, ... with no gaps
    at: v.number(),
    actorId: v.optional(v.id("users")), // absent when run from the CLI with the deploy/admin key
    action: v.union(
      v.literal("tool.removed_by_admin"),
      v.literal("user.trusted_lender_set"),
      v.literal("user.role_set"),
      v.literal("loan_event.retried"),
      v.literal("automation.overdue_sweep_requested"),
      v.literal("security.emails_reencrypted"),
    ),
    targetId: v.string(),
    detail: v.optional(v.string()),
    prevHash: v.string(), // hash of entry seq - 1 ("genesis" for the first)
    hash: v.string(), // SHA-256 over this entry's fields and prevHash
  })
    .index("by_seq", ["seq"])
    .index("by_actor", ["actorId"]),
});
