"use client";

import { SignInButton } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { useViewerState } from "@/components/providers/ViewerProvider";
import { Button, EmptyState, PageSpinner } from "@/components/ui";

// Renders the signed-in area only once Convex has accepted the Clerk session and
// the user row is synced. proxy.ts already redirects signed-out visitors; this covers
// the client side (token refresh, sign-out in another tab). Data access is still
// decided by Convex, not by this component.
export function SignedInGate({ children }: { children: ReactNode }) {
  const state = useViewerState();
  switch (state.status) {
    case "loading":
      return <PageSpinner />;
    case "signed-out":
      return (
        <div className="mx-auto max-w-md py-16">
          <EmptyState title="Sign in to lend or borrow">
            <div className="mt-4">
              <SignInButton mode="modal">
                <Button>Sign in</Button>
              </SignInButton>
            </div>
          </EmptyState>
        </div>
      );
    case "error":
      return (
        <div className="mx-auto max-w-md py-16">
          <EmptyState title="Something went wrong">{state.message}</EmptyState>
        </div>
      );
    case "ready":
      return <>{children}</>;
  }
}
