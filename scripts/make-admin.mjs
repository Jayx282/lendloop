#!/usr/bin/env node
// Grants the admin role to a user who has signed in at least once.
//   npm run make-admin -- you@example.com
// Runs an internal Convex function with the deployment's admin key, so it
// can't be done from the browser.

import { spawnSync } from "node:child_process";

const email = process.argv[2];
if (!email || !email.includes("@")) {
  console.error("Usage: npm run make-admin -- you@example.com");
  process.exit(1);
}
const result = spawnSync("npx", ["convex", "run", "users:setRole", JSON.stringify({ email, role: "admin" })], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
