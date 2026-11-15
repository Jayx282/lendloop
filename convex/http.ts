import { httpRouter } from "convex/server";
import type { JWTPayload } from "jose";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { httpAction, type ActionCtx } from "./_generated/server";
import { bearerToken, verifyFromN8n } from "./lib/jwt";

// Endpoints for n8n only. Each one requires a fresh HS256 token signed with
// N8N_TO_CONVEX_SIGNING_SECRET whose `scope` names that endpoint. The data is
// read from the verified claims; the request body is ignored. Error responses
// stay generic so a caller learns nothing about why a token was rejected.

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function authenticate(request: Request, scope: string): Promise<JWTPayload | null> {
  const token = bearerToken(request);
  if (!token) return null;
  try {
    return await verifyFromN8n(token, scope);
  } catch (error) {
    console.warn(`Rejected n8n call for scope "${scope}": ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

function signedEndpoint(scope: string, handle: (ctx: ActionCtx, claims: JWTPayload) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    const claims = await authenticate(request, scope);
    if (!claims) return json(401, { error: "unauthorized" });
    try {
      return await handle(ctx, claims);
    } catch (error) {
      // Argument validation errors (bad IDs, wrong types) end up here.
      console.warn(`Bad n8n payload for scope "${scope}": ${error instanceof Error ? error.message : error}`);
      return json(400, { error: "invalid payload" });
    }
  });
}

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

const http = httpRouter();

// Fetch-and-claim (a POST because it reserves each returned loan for this run).
http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: signedEndpoint("overdue-loans:claim", async (ctx, claims) => {
    const runId = String(claims.run ?? claims.jti ?? "unknown");
    return json(200, await ctx.runMutation(internal.automation.claimOverdueReminders, { runId }));
  }),
});

http.route({
  path: "/n8n/reminders",
  method: "POST",
  handler: signedEndpoint("reminders:write", async (ctx, claims) => {
    const result = await ctx.runMutation(internal.automation.recordReminder, {
      reminderKey: String(claims.reminderKey),
      loanId: String(claims.loanId) as Id<"loans">, // checked by the mutation's v.id("loans") validator
      status: claims.status as "sent" | "failed",
      channel: String(claims.channel ?? "email"),
      error: str(claims.error),
      executionId: str(claims.executionId),
    });
    return result.ok ? json(200, result) : json(400, { error: result.error });
  }),
});

http.route({
  path: "/n8n/notification-receipts",
  method: "POST",
  handler: signedEndpoint("notification-receipts:write", async (ctx, claims) => {
    const result = await ctx.runMutation(internal.notifications.recordReceipt, {
      eventId: String(claims.eventId),
      status: claims.status as "sent" | "failed",
      channel: String(claims.channel ?? "email"),
      error: str(claims.error),
    });
    return result.found ? json(200, result) : json(404, { error: "unknown event" });
  }),
});

http.route({
  path: "/n8n/failures",
  method: "POST",
  handler: signedEndpoint("failures:write", async (ctx, claims) => {
    const result = await ctx.runMutation(internal.automation.recordFailure, {
      executionId: String(claims.executionId),
      workflowName: String(claims.workflowName ?? "unknown workflow"),
      node: str(claims.node),
      message: String(claims.message ?? "no error message"),
    });
    return json(200, result);
  }),
});

export default http;
