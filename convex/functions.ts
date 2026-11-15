import { customCtx, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireViewer } from "./lib/auth";

// Function builders that resolve the signed-in user before the handler runs.
// A handler built with these cannot forget the auth check, and gets the
// trusted `ctx.viewer` (from the database, never from client arguments).

export const userQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ viewer: await requireViewer(ctx) })),
);

export const userMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ viewer: await requireViewer(ctx) })),
);

export const adminQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ viewer: await requireAdmin(ctx) })),
);

export const adminMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ viewer: await requireAdmin(ctx) })),
);
