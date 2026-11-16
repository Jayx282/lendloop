import { SignedInGate } from "@/components/SignedInGate";

// The signed-in pages render in the browser: their data streams live from Convex
// once the Clerk session is verified, so there is no server-rendered content to
// prerender or validate for instant navigation.
export const instant = false;

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <SignedInGate>{children}</SignedInGate>;
}
