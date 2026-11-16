import { BrowseView } from "./BrowseView";

// Rendered in the browser behind the sign-in gate (see ../layout.tsx).
export const instant = false;

export default function Page() {
  return <BrowseView />;
}
