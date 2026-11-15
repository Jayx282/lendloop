"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { useViewerState } from "@/components/providers/ViewerProvider";
import { Button, cx } from "@/components/ui";

const LINKS = [
  { href: "/tools", label: "Browse" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming" },
];

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight text-stone-900">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true">
        <rect width="32" height="32" rx="9" className="fill-emerald-700" />
        <path
          d="M11.5 20.5a4.5 4.5 0 1 1 0-9c2.5 0 3.7 2.2 4.5 4.5s2 4.5 4.5 4.5a4.5 4.5 0 1 0 0-9"
          fill="none"
          stroke="white"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </svg>
      LendLoop
    </span>
  );
}

function NavLinks({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const links = isAdmin ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;
  return (
    <nav aria-label="Main" className="flex items-center gap-1 overflow-x-auto">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-emerald-50 text-emerald-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Header() {
  const state = useViewerState();
  // usePathname() is request data, so the nav streams in behind a Suspense boundary
  // and the rest of the header stays in the static shell.
  const nav =
    state.status === "ready" ? (
      <Suspense fallback={null}>
        <NavLinks isAdmin={state.viewer.role === "admin"} />
      </Suspense>
    ) : null;

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" aria-label="LendLoop home">
          <Logo />
        </Link>
        <div className="hidden md:block">{nav}</div>
        <div className="ml-auto flex items-center gap-3">
          {state.status === "signed-out" && (
            <SignInButton mode="modal">
              <Button size="sm">Sign in to lend or borrow</Button>
            </SignInButton>
          )}
          {state.status === "ready" && state.viewer.trustedLender && (
            <span className="hidden text-xs font-medium text-violet-700 sm:inline">Trusted Lender</span>
          )}
          {state.status !== "signed-out" && <UserButton />}
        </div>
      </div>
      {nav && <div className="border-t border-stone-100 px-2 py-1.5 md:hidden">{nav}</div>}
    </header>
  );
}
