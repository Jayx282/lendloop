import type { AuthConfig } from "convex/server";

// Convex verifies Clerk session tokens against this issuer's public keys (JWKS)
// and only accepts tokens with `aud: "convex"` (set by Clerk's Convex integration).
export default {
  providers: [
    {
      domain: process.env.CLERK_FRONTEND_API_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
