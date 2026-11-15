/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { api } from "./_generated/api";
import schema from "./schema";

// Shared helpers for the Convex tests (files with two dots are never deployed).

export const modules = import.meta.glob("./**/*.*s");

export function setup() {
  const t = convexTest(schema, modules);
  const as = (subject: string, name: string, email = `${subject}@example.com`) =>
    t.withIdentity({ subject, issuer: "https://clerk.test", name, email, emailVerified: true });
  return { t, as };
}

export async function signedIn(user: ReturnType<ReturnType<typeof setup>["as"]>) {
  const id = await user.mutation(api.users.sync, {});
  return { user, id };
}

export function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}
