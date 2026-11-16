import { MyListingsView } from "./MyListingsView";

// Rendered in the browser behind the sign-in gate (see ../layout.tsx).
export const instant = false;

export default function Page() {
  return <MyListingsView />;
}
