#!/usr/bin/env node
// One-command local setup for LendLoop. Safe to re-run.
//
//   npm run setup            # secrets, containers, Convex env, push functions
//   npm run setup -- --seed  # ...and load demo data
//
// It never prints secret values.

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
process.chdir(root);
const seed = process.argv.includes("--seed");

const step = (message) => console.log(`\n▸ ${message}`);
const fail = (message) => {
  console.error(`\n✖ ${message}`);
  process.exit(1);
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) fail(`\`${command} ${args.join(" ")}\` failed`);
}

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const entries = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]);
  return Object.fromEntries(entries);
}

function setEnvValue(file, key, value) {
  let text = fs.readFileSync(file, "utf8");
  const pattern = new RegExp(`^${key}=.*$`, "m");
  text = pattern.test(text) ? text.replace(pattern, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  fs.writeFileSync(file, text, { mode: 0o600 });
}

function compose() {
  for (const [command, prefix] of [
    ["docker", ["compose"]],
    ["docker-compose", []],
  ]) {
    const probe = spawnSync(command, [...prefix, "version"], { stdio: "ignore" });
    if (probe.status === 0) {
      return {
        run: (args) => run(command, [...prefix, ...args]),
        output: (args) => execFileSync(command, [...prefix, ...args], { encoding: "utf8" }).trim(),
      };
    }
  }
  fail("Docker Compose not found. Install Docker Desktop (or Docker Engine + the compose plugin).");
}

// 1. Signing secrets for Convex <-> n8n (gitignored, owner-only permissions).
step("Signing secrets (.env.automation)");
if (!fs.existsSync(".env.automation")) {
  const secret = () => randomBytes(32).toString("hex");
  fs.writeFileSync(
    ".env.automation",
    `CONVEX_TO_N8N_SIGNING_SECRET=${secret()}\nN8N_TO_CONVEX_SIGNING_SECRET=${secret()}\n`,
    { mode: 0o600 },
  );
  console.log("  generated two random 256-bit secrets");
} else {
  console.log("  already present, keeping it");
}
const automation = readEnv(".env.automation");
for (const key of ["CONVEX_TO_N8N_SIGNING_SECRET", "N8N_TO_CONVEX_SIGNING_SECRET"]) {
  if ((automation[key] ?? "").length < 32) fail(`${key} in .env.automation must be at least 32 characters.`);
}

// 1b. The key that encrypts personal data in Convex. A separate file, because
// .env.automation is handed to the n8n import container and this key isn't for n8n.
step("Data encryption key (.env.convex)");
if (!fs.existsSync(".env.convex")) {
  fs.writeFileSync(".env.convex", `LENDLOOP_DATA_KEY=${randomBytes(32).toString("base64")}\n`, { mode: 0o600 });
  console.log("  generated a random 256-bit key");
} else {
  console.log("  already present, keeping it");
}
const dataKeys = readEnv(".env.convex");
for (const key of ["LENDLOOP_DATA_KEY", "LENDLOOP_DATA_KEY_PREVIOUS"]) {
  const value = dataKeys[key];
  if (value === undefined || (value === "" && key.endsWith("_PREVIOUS"))) continue;
  if (Buffer.from(value, "base64").length !== 32) fail(`${key} in .env.convex must be 32 bytes, base64-encoded.`);
}
if (!dataKeys.LENDLOOP_DATA_KEY) fail("LENDLOOP_DATA_KEY is missing from .env.convex.");

// 2. App settings: Clerk keys are the only thing you have to provide.
step("App settings (.env.local)");
if (!fs.existsSync(".env.local")) {
  fs.copyFileSync(".env.example", ".env.local");
  fs.chmodSync(".env.local", 0o600);
}
let local = readEnv(".env.local");
const missingClerk = [
  ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", (v) => v.startsWith("pk_") && !v.includes("replace_me")],
  ["CLERK_SECRET_KEY", (v) => v.startsWith("sk_") && !v.includes("replace_me")],
  ["CLERK_FRONTEND_API_URL", (v) => v.startsWith("https://") && !v.includes("your-app-00")],
].filter(([key, ok]) => !ok(local[key] ?? ""));
if (missingClerk.length > 0) {
  fail(
    `Add your Clerk keys to .env.local first: ${missingClerk.map(([k]) => k).join(", ")}.\n` +
      "  See README > Local setup > 1. Clerk.",
  );
}

// 3. Containers: Convex backend + dashboard, n8n (+ one-shot import), Mailpit.
step("Starting Docker services");
const dc = compose();
dc.run(["up", "-d", "--wait"]);

// 4. Convex admin key for the CLI (stays in .env.local). It is derived from the
// backend's instance secret, so regenerate it every time: after `docker compose
// down -v` the instance gets a new secret and an old key stops working.
step("Convex admin key");
const key = dc.output(["exec", "-T", "convex-backend", "./generate_admin_key.sh"]).split(/\r?\n/).pop();
if (!key) fail("Could not generate a Convex admin key.");
if (key !== local.CONVEX_SELF_HOSTED_ADMIN_KEY) {
  setEnvValue(".env.local", "CONVEX_SELF_HOSTED_ADMIN_KEY", key);
  local = readEnv(".env.local");
  console.log("  written to .env.local");
} else {
  console.log("  up to date in .env.local");
}

// 5. Convex deployment env vars (server-side only, never sent to the browser).
step("Convex environment variables");
const convexEnv = {
  CLERK_FRONTEND_API_URL: local.CLERK_FRONTEND_API_URL,
  CONVEX_TO_N8N_SIGNING_SECRET: automation.CONVEX_TO_N8N_SIGNING_SECRET,
  N8N_TO_CONVEX_SIGNING_SECRET: automation.N8N_TO_CONVEX_SIGNING_SECRET,
  // Inside the Docker network Convex reaches n8n by service name.
  N8N_LOAN_EVENTS_WEBHOOK_URL: "http://n8n:5678/webhook/lendloop/loan-events",
  N8N_OVERDUE_SWEEP_WEBHOOK_URL: "http://n8n:5678/webhook/lendloop/overdue-sweep",
  LENDLOOP_APP_URL: "http://localhost:3000",
  LENDLOOP_DATA_KEY: dataKeys.LENDLOOP_DATA_KEY,
  // Only set during a key rotation (see convex/security.ts).
  ...(dataKeys.LENDLOOP_DATA_KEY_PREVIOUS ? { LENDLOOP_DATA_KEY_PREVIOUS: dataKeys.LENDLOOP_DATA_KEY_PREVIOUS } : {}),
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lendloop-"));
const envFile = path.join(tmp, "convex.env");
try {
  fs.writeFileSync(
    envFile,
    Object.entries(convexEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    { mode: 0o600 },
  );
  run("npx", ["convex", "env", "set", "--force", "--from-file", envFile]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 6. Push schema and functions.
step("Pushing Convex functions");
run("npx", ["convex", "dev", "--once", "--typecheck", "enable"]);

if (seed) {
  step("Loading demo data");
  run("npx", ["convex", "run", "seed:demo"]);
}

console.log(`
✔ LendLoop is set up.

  npm run dev                      app        http://localhost:3000
                                   n8n        http://localhost:5678  (create the local owner login on first visit)
                                   inbox      http://localhost:8025  (every email n8n sends lands here)
                                   Convex     http://localhost:6791  (dashboard; log in with the admin key from .env.local)

  Sign in once, then make yourself an admin:
  npm run make-admin -- you@example.com
`);
