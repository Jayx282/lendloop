import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { query, type MutationCtx } from "./_generated/server";
import { userMutation, userQuery } from "./functions";
import { fail, type Viewer } from "./lib/auth";
import { approvedLoans, availabilityOf } from "./lib/availability";
import { LIMITS, categoryValidator, conditionValidator } from "./lib/constants";
import { todayUtc } from "./lib/dates";
import { cleanText } from "./lib/text";
import { enqueueLoanEvent } from "./notifications";

const toolFields = {
  name: v.string(),
  category: categoryValidator,
  condition: conditionValidator,
  description: v.string(),
};

function cleanToolFields(args: { name: string; description: string }) {
  return {
    name: cleanText(args.name, "Name", { min: LIMITS.toolName.min, max: LIMITS.toolName.max }),
    description: cleanText(args.description, "Description", { max: LIMITS.description.max }),
  };
}

/**
 * Public, no sign-in: tools that are free today, with name and category only.
 * The `returns` validator is the data contract: Convex rejects the response if
 * anything else (owner, condition, IDs) ever leaks into it.
 */
export const listPublic = query({
  args: {},
  returns: v.array(v.object({ name: v.string(), category: categoryValidator })),
  handler: async (ctx) => {
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_removed_category", (q) => q.eq("removedAt", undefined))
      .take(500);
    const available: { name: string; category: (typeof tools)[number]["category"] }[] = [];
    for (const tool of tools) {
      const availability = await availabilityOf(ctx, tool._id, today);
      if (availability.state === "available") available.push({ name: tool.name, category: tool.category });
    }
    return available.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Signed-in browse view: every listed tool with its availability, filterable by category. */
export const browse = userQuery({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_removed_category", (q) =>
        category ? q.eq("removedAt", undefined).eq("category", category) : q.eq("removedAt", undefined),
      )
      .take(500);

    const myLoans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", ctx.viewer._id))
      .collect();
    const myOpen = myLoans.filter((l) => l.status === "requested" || l.status === "approved");

    const rows = await Promise.all(
      tools.map(async (tool) => {
        const owner = await ctx.db.get(tool.ownerId);
        const mine = myOpen.find((l) => l.toolId === tool._id);
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          availability: await availabilityOf(ctx, tool._id, today),
          isMine: tool.ownerId === ctx.viewer._id,
          // Signed-in neighbours see the lender's display name and badge, nothing else.
          lender: {
            displayName: owner?.displayName ?? "Neighbour",
            trustedLender: owner?.trustedLender ?? false,
          },
          myOpenRequest: mine ? { status: mine.status, startDate: mine.startDate, endDate: mine.endDate } : null,
        };
      }),
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const mine = userQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.viewer._id))
      .order("desc")
      .collect();
    return await Promise.all(
      tools
        .filter((tool) => tool.removedAt === undefined)
        .map(async (tool) => {
          const pending = await ctx.db
            .query("loans")
            .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "requested"))
            .collect();
          return {
            _id: tool._id,
            name: tool.name,
            category: tool.category,
            condition: tool.condition,
            description: tool.description,
            availability: await availabilityOf(ctx, tool._id, today),
            pendingRequests: pending.length,
          };
        }),
    );
  },
});

export const create = userMutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const active = (
      await ctx.db
        .query("tools")
        .withIndex("by_owner", (q) => q.eq("ownerId", ctx.viewer._id))
        .collect()
    ).filter((t) => t.removedAt === undefined);
    if (active.length >= LIMITS.activeListingsPerUser) {
      fail(`You can list up to ${LIMITS.activeListingsPerUser} tools at a time.`, "LIMIT");
    }
    return await ctx.db.insert("tools", {
      ownerId: ctx.viewer._id,
      category: args.category,
      condition: args.condition,
      ...cleanToolFields(args),
    });
  },
});

/** Owners only: admins can remove listings but not rewrite them. */
export const update = userMutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const tool = await ctx.db.get(toolId);
    // "Not found" for other people's tools too, so IDs can't be probed.
    if (!tool || tool.removedAt !== undefined || tool.ownerId !== ctx.viewer._id) {
      fail("Listing not found.", "NOT_FOUND");
    }
    await ctx.db.patch(toolId, {
      category: args.category,
      condition: args.condition,
      ...cleanToolFields(args),
    });
  },
});

/**
 * Owners can delete their own listings; admins can remove any listing.
 * Pending requests are declined (and the borrowers notified). An owner can't
 * delete a tool that is out on an approved loan; an admin can, and that loan
 * stays open until the lender marks it returned.
 */
export const remove = userMutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removedAt !== undefined) fail("Listing not found.", "NOT_FOUND");
    const isOwner = tool.ownerId === ctx.viewer._id;
    const isAdmin = ctx.viewer.role === "admin";
    if (!isOwner && !isAdmin) fail("Listing not found.", "NOT_FOUND");

    if (!isAdmin && (await approvedLoans(ctx, toolId)).length > 0) {
      fail("This tool has an approved loan. Mark it returned (or ask the borrower to cancel) before deleting it.");
    }
    await removeTool(
      ctx,
      toolId,
      ctx.viewer,
      isOwner ? "Listing deleted by its owner." : "Listing removed by an admin.",
    );
    if (!isOwner) {
      await ctx.db.insert("auditLog", {
        actorId: ctx.viewer._id,
        action: "tool.removed_by_admin",
        targetId: toolId,
        detail: tool.name,
      });
    }
  },
});

async function removeTool(ctx: MutationCtx, toolId: Id<"tools">, actor: Viewer, reason: string) {
  await ctx.db.patch(toolId, { removedAt: Date.now(), removedBy: actor._id });
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "requested"))
    .collect();
  for (const loan of pending) {
    await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now(), closedReason: reason });
    await enqueueLoanEvent(ctx, loan._id, "loan.declined");
  }
}
