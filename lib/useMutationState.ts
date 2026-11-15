"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useCallback, useState } from "react";

/** User-facing message for a failed Convex call. Only ConvexError text is shown verbatim. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  return "Something went wrong. Please try again.";
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Wraps a Convex mutation with pending and error state for buttons and forms. */
export function useMutationState<M extends FunctionReference<"mutation">>(mutation: M) {
  const mutate = useMutation(mutation) as unknown as (args: FunctionArgs<M>) => Promise<FunctionReturnType<M>>;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (args: FunctionArgs<M>): Promise<Result<FunctionReturnType<M>>> => {
      setPending(true);
      setError(null);
      try {
        return { ok: true, value: await mutate(args) };
      } catch (e) {
        const message = errorMessage(e);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setPending(false);
      }
    },
    [mutate],
  );

  const clearError = useCallback(() => setError(null), []);
  return { run, pending, error, clearError };
}
