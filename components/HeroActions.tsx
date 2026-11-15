"use client";

import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { useViewerState } from "@/components/providers/ViewerProvider";

export function HeroActions() {
  const state = useViewerState();
  if (state.status === "ready") {
    return (
      <Link
        href="/tools"
        className="inline-flex h-11 items-center rounded-lg bg-white px-5 text-sm font-semibold text-emerald-900 hover:bg-emerald-50"
      >
        Browse tools, {state.viewer.displayName}
      </Link>
    );
  }
  return (
    <SignInButton mode="modal">
      <button
        type="button"
        className="inline-flex h-11 items-center rounded-lg bg-white px-5 text-sm font-semibold text-emerald-900 hover:bg-emerald-50"
      >
        Sign in to lend or borrow
      </button>
    </SignInButton>
  );
}
