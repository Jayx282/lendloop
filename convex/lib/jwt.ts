import { SignJWT, jwtVerify, type JWTPayload } from "jose";

// Messages between Convex and n8n are compact JWS tokens signed with
// HMAC-SHA256 (JWT "HS256") and a shared secret per direction:
//   Convex -> n8n: CONVEX_TO_N8N_SIGNING_SECRET (n8n verifies with its JWT credential)
//   n8n -> Convex: N8N_TO_CONVEX_SIGNING_SECRET (Convex verifies here)
// The payload travels inside the signed token, so the receiver only ever acts on
// verified claims and there is no body-canonicalization step to get wrong.
// `exp` limits replay to five minutes, `iss`/`aud` pin the direction, `jti` is
// the idempotency key and `scope` names the one endpoint a token is good for.

export const CONVEX_ISSUER = "lendloop-convex";
export const N8N_ISSUER = "lendloop-n8n";
const TOKEN_LIFETIME = "5m";
const MIN_SECRET_LENGTH = 32;

type SecretName = "CONVEX_TO_N8N_SIGNING_SECRET" | "N8N_TO_CONVEX_SIGNING_SECRET";

function secretKey(name: SecretName): Uint8Array {
  const secret = process.env[name];
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    // Fail closed: never sign or accept anything with a missing or weak secret.
    throw new Error(`${name} is not set or is shorter than ${MIN_SECRET_LENGTH} characters`);
  }
  return new TextEncoder().encode(secret);
}

/** Signs a message for n8n. `jti` must be unique per logical message (it is n8n's dedupe key). */
export async function signForN8n(claims: JWTPayload, jti: string): Promise<string> {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(CONVEX_ISSUER)
    .setAudience(N8N_ISSUER)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(TOKEN_LIFETIME)
    .sign(secretKey("CONVEX_TO_N8N_SIGNING_SECRET"));
}

/** Verifies a token n8n sent to Convex. Throws unless it is valid, fresh and meant for `scope`. */
export async function verifyFromN8n(token: string, scope: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secretKey("N8N_TO_CONVEX_SIGNING_SECRET"), {
    algorithms: ["HS256"], // never "none", never an algorithm chosen by the sender
    issuer: N8N_ISSUER,
    audience: CONVEX_ISSUER,
    maxTokenAge: TOKEN_LIFETIME,
    clockTolerance: 30,
    requiredClaims: ["iat", "exp", "scope"],
  });
  if (payload.scope !== scope) throw new Error("token scope does not match this endpoint");
  return payload;
}

export function bearerToken(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  return match ? match[1] : null;
}
