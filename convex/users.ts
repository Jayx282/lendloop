import type { UserIdentity } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { adminMutation, adminQuery } from "./functions";
import { fail, getViewer } from "./lib/auth";
import { LIMITS, roleValidator } from "./lib/constants";

// Neighbours see "Asha K.", never a full name.
export function displayNameFrom(identity: Pick<UserIdentity, "givenName" | "familyName" | "name">): string {
  const nameParts = identity.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  const first = identity.givenName?.trim() || nameParts[0] || "";
  const last = identity.familyName?.trim() || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : "");
  const display = first && last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
  return display.slice(0, LIMITS.displayName.max) || "Neighbour";
}

function verifiedEmailFrom(identity: UserIdentity): string | undefined {
  const email = identity.email?.trim().toLowerCase();
  if (!email || identity.emailVerified === false) return undefined;
  return email;
}

/**
 * Creates or refreshes the caller's user row from their verified Clerk token.
 * Called by the client right after sign-in. Takes no arguments on purpose:
 * name and email come from the token, so a client cannot claim someone else's email.
 */
export const sync = mutation({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("Sign in to continue.", "UNAUTHENTICATED");

    const displayName = displayNameFrom(identity);
    const email = verifiedEmailFrom(identity);
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      if (existing.displayName !== displayName || existing.email !== email) {
        await ctx.db.patch(existing._id, { displayName, email });
      }
      return existing._id;
    }
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      displayName,
      email,
      role: "user",
      trustedLender: false,
    });
  },
});

/** The signed-in user's own profile, or null before sign-in / sync. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return {
      _id: viewer._id,
      displayName: viewer.displayName,
      role: viewer.role,
      trustedLender: viewer.trustedLender,
      hasEmail: viewer.email !== undefined,
    };
  },
});

export const list = adminQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").order("desc").take(500);
    return await Promise.all(
      users.map(async (user) => {
        const tools = await ctx.db
          .query("tools")
          .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
          .collect();
        // Admins manage roles and trust; they don't need neighbours' emails for that.
        return {
          _id: user._id,
          displayName: user.displayName,
          role: user.role,
          trustedLender: user.trustedLender,
          activeListings: tools.filter((t) => t.removedAt === undefined).length,
          joinedAt: user._creationTime,
        };
      }),
    );
  },
});

export const setTrustedLender = adminMutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const user = await ctx.db.get(userId);
    if (!user) fail("User not found.", "NOT_FOUND");
    if (user.trustedLender === trusted) return;
    await ctx.db.patch(userId, {
      trustedLender: trusted,
      trustedLenderSince: trusted ? Date.now() : undefined,
    });
    await ctx.db.insert("auditLog", {
      actorId: ctx.viewer._id,
      action: "user.trusted_lender_set",
      targetId: userId,
      detail: trusted ? "trusted" : "not trusted",
    });
  },
});

/**
 * Bootstrap or change a role from the CLI (needs the deployment's admin key):
 *   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
 * Deliberately not callable from the browser, so nobody can promote themselves.
 */
export const setRole = internalMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, { email, role }) => {
    const matches = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .take(2);
    if (matches.length === 0) {
      fail("No user with that email has signed in yet. Sign in once, then rerun this.", "NOT_FOUND");
    }
    if (matches.length > 1) fail("More than one user has that email.", "AMBIGUOUS");
    const user = matches[0];
    await ctx.db.patch(user._id, { role });
    await ctx.db.insert("auditLog", { action: "user.role_set", targetId: user._id, detail: role });
    return { userId: user._id, displayName: user.displayName, role };
  },
});
