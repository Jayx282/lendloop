"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/useMutationState";

export type Viewer = NonNullable<FunctionReturnType<typeof api.users.me>>;

type ViewerState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; viewer: Viewer };

const ViewerContext = createContext<ViewerState>({ status: "loading" });

/**
 * Once Convex has accepted the Clerk token, creates/refreshes the user row
 * (users.sync) and exposes the signed-in user's profile and role to the UI.
 * The role is only used to decide what to show; Convex enforces it.
 */
export function ViewerProvider({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const sync = useMutation(api.users.sync);
  const [synced, setSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const me = useQuery(api.users.me, isAuthenticated && synced ? {} : "skip");

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    sync({})
      .then(() => {
        if (!cancelled) setSynced(true);
      })
      .catch((error) => {
        if (!cancelled) setSyncError(errorMessage(error));
      });
    return () => {
      cancelled = true;
      setSynced(false);
      setSyncError(null);
    };
  }, [isAuthenticated, sync]);

  let state: ViewerState;
  if (isLoading) state = { status: "loading" };
  else if (!isAuthenticated) state = { status: "signed-out" };
  else if (syncError) state = { status: "error", message: syncError };
  else if (!synced || me === undefined) state = { status: "loading" };
  else if (me === null) state = { status: "error", message: "We couldn't load your account." };
  else state = { status: "ready", viewer: me };

  return <ViewerContext.Provider value={state}>{children}</ViewerContext.Provider>;
}

export function useViewerState(): ViewerState {
  return useContext(ViewerContext);
}

/** For components rendered inside the signed-in area (app/(app)/layout.tsx guarantees a viewer). */
export function useViewer(): Viewer {
  const state = useContext(ViewerContext);
  if (state.status !== "ready") throw new Error("useViewer() used outside the signed-in area");
  return state.viewer;
}
