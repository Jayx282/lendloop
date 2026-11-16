import { clerkMiddleware } from "@clerk/nextjs/server";

// Signed-out visitors who open an app page are sent to sign in. This is a UX
// guard only: every private query and mutation checks the caller again in Convex.
const SIGNED_IN_ONLY = ["/tools", "/listings", "/requests", "/incoming", "/admin"];

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "http://127.0.0.1:3210";

export default clerkMiddleware(
  async (auth, request) => {
    const path = request.nextUrl.pathname;
    if (SIGNED_IN_ONLY.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      await auth.protect();
    }
  },
  {
    // Clerk's CSP defaults, plus the Convex deployment (HTTPS + WebSocket) and
    // inline data: images (decorative SVGs in Clerk's components; images can't run code).
    contentSecurityPolicy: {
      directives: {
        "connect-src": [convexUrl, convexUrl.replace(/^http/, "ws")],
        "img-src": ["data:"],
        "frame-ancestors": ["'none'"],
      },
    },
  },
);

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk-specific frontend API routes
    "/__clerk/(.*)",
  ],
};
