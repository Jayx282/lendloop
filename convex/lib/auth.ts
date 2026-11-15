import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

// Authorization lives here, in the Convex functions, not in the UI. Every
// public query or mutation that touches private data goes through
// requireViewer / requireAdmin (via the builders in ../functions.ts).

export type Viewer = Doc<"users">;

export async function getViewer(ctx: QueryCtx | MutationCtx): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireViewer(ctx: QueryCtx | MutationCtx): Promise<Viewer> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to continue." });
  }
  const viewer = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!viewer) {
    // The client calls users.sync right after sign-in; this only happens if it hasn't yet.
    throw new ConvexError({ code: "USER_NOT_SYNCED", message: "Your account is still being set up." });
  }
  return viewer;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Viewer> {
  const viewer = await requireViewer(ctx);
  if (viewer.role !== "admin") {
    throw new ConvexError({ code: "FORBIDDEN", message: "Only admins can do that." });
  }
  return viewer;
}

/** Throws a user-facing error. ConvexError messages reach the client; other errors are redacted. */
export function fail(message: string, code = "INVALID"): never {
  throw new ConvexError({ code, message });
}
