import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { addDays, todayUtc } from "./lib/dates";

/**
 * Local demo data: three neighbours, a few tools and loans in every state,
 * including one overdue loan so the reminder workflow has something to do.
 *   npx convex run seed:demo
 * Internal (needs the admin key), idempotent, and sends no notifications.
 * Demo users can't sign in: their token identifiers don't match any Clerk issuer.
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", "demo|asha"))
      .unique();
    if (existing) return "Demo data already exists.";

    const today = todayUtc();
    const user = (slug: string, displayName: string, trustedLender = false) =>
      ctx.db.insert("users", {
        tokenIdentifier: `demo|${slug}`,
        displayName,
        email: `${slug}@example.com`,
        role: "user",
        trustedLender,
        trustedLenderSince: trustedLender ? Date.now() : undefined,
      });
    const asha = await user("asha", "Asha K.", true);
    const ravi = await user("ravi", "Ravi M.");
    const meera = await user("meera", "Meera S.");

    const tool = (
      ownerId: Id<"users">,
      name: string,
      category: "power-tools" | "hand-tools" | "garden" | "kitchen" | "camping" | "cleaning" | "other",
      condition: "like-new" | "good" | "fair" | "worn",
      description: string,
    ) => ctx.db.insert("tools", { ownerId, name, category, condition, description });

    const drill = await tool(asha, "Cordless drill", "power-tools", "good", "18V with two batteries and a bit set.");
    const trimmer = await tool(
      asha,
      "Hedge trimmer",
      "garden",
      "fair",
      "Electric, 50 cm blade. Needs an extension cord.",
    );
    await tool(asha, "4-person tent", "camping", "like-new", "Dome tent, pitched twice. Footprint included.");
    const washer = await tool(ravi, "Pressure washer", "cleaning", "good", "1800 W, patio and car nozzles.");
    await tool(ravi, "Stand mixer", "kitchen", "like-new", "5 L bowl, whisk, dough hook and paddle.");
    const ladder = await tool(ravi, "Extension ladder", "other", "worn", "4.2 m aluminium. Heavy, so pick up by car.");
    await tool(meera, "Socket wrench set", "hand-tools", "good", "Metric and imperial, 40 pieces.");
    await tool(meera, "Camping stove", "camping", "good", "Two burners. Gas canister not included.");

    const loan = (
      toolId: Id<"tools">,
      lenderId: Id<"users">,
      borrowerId: Id<"users">,
      startOffset: number,
      endOffset: number,
      status: "requested" | "approved" | "returned",
      note?: string,
    ) =>
      ctx.db.insert("loans", {
        toolId,
        lenderId,
        borrowerId,
        startDate: addDays(today, startOffset),
        endDate: addDays(today, endOffset),
        status,
        note,
        decidedAt: status === "requested" ? undefined : Date.now(),
        returnedAt: status === "returned" ? Date.now() : undefined,
      });

    await loan(trimmer, asha, ravi, -6, -2, "approved", "For the front hedge this weekend."); // overdue
    await loan(washer, ravi, meera, -1, 3, "approved"); // on loan
    await loan(drill, asha, meera, 2, 4, "requested", "Putting up shelves. I'll bring it back charged.");
    await loan(ladder, ravi, asha, -20, -18, "returned");
    return "Seeded 3 neighbours, 8 tools and 4 loans (one overdue).";
  },
});
