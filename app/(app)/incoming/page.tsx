import { IncomingView } from "./IncomingView";

// Rendered in the browser behind the sign-in gate (see ../layout.tsx).
export const instant = false;

export default function Page() {
  return <IncomingView />;
}
