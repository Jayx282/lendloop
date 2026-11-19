"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { timeAgo } from "@/lib/format";

type SecurityStatus = FunctionReturnType<typeof api.security.status>;

const ACTIONS: Record<SecurityStatus["entries"][number]["action"], string> = {
  "tool.removed_by_admin": "Removed a listing",
  "user.trusted_lender_set": "Changed a Trusted Lender badge",
  "user.role_set": "Changed a role",
  "loan_event.retried": "Retried a notification",
  "automation.overdue_sweep_requested": "Ran the overdue check",
  "security.emails_reencrypted": "Re-encrypted emails",
};

const short = (hash: string) => `${hash.slice(0, 10)}…`;

export function SecurityPanel({ status }: { status: SecurityStatus }) {
  const { encryption, chain, entries } = status;
  return (
    <section aria-labelledby="security-heading" className="mt-10">
      <h2 id="security-heading" className="mb-3 text-lg font-semibold">
        Security
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Personal data at rest</p>
          <p className="mt-1 font-semibold text-stone-900">
            {encryption.withEmail} of {encryption.users} email addresses encrypted
          </p>
          <p className="mt-1 text-sm text-stone-600">
            {encryption.algorithm}. Current key <code className="font-mono text-xs">{encryption.keyId}</code>.
          </p>
          {encryption.onOlderKey > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {encryption.onOlderKey} still on an older key. Run{" "}
              <code className="font-mono text-xs">npx convex run security:reencryptEmails</code>.
            </p>
          )}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Audit trail</p>
          {chain.ok ? (
            <>
              <p className="mt-1 flex items-center gap-2 font-semibold text-stone-900">
                <Badge tone="green">Verified</Badge>
                {chain.entries} {chain.entries === 1 ? "entry" : "entries"}, hash-chained
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Head #{chain.headSeq} <code className="font-mono text-xs">{short(chain.headHash)}</code>. Every hash was
                recomputed just now.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 flex items-center gap-2 font-semibold text-rose-700">
                <Badge tone="red">Broken</Badge>
                at entry #{chain.brokenAt}
              </p>
              <p className="mt-1 text-sm text-rose-700">
                Entry #{chain.brokenAt} fails verification: {chain.reason}.
              </p>
            </>
          )}
        </Card>
      </div>

      <SectionTitle count={entries.length}>Recent audit entries</SectionTitle>
      {entries.length === 0 ? (
        <p className="text-sm text-stone-500">No privileged actions yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">What</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {entries.map((entry) => (
                <tr key={entry.seq}>
                  <td className="px-4 py-2.5 text-stone-500">{entry.seq}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{timeAgo(entry.at)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{entry.actor}</td>
                  <td className="px-4 py-2.5">
                    {ACTIONS[entry.action]}
                    {entry.detail && <span className="text-stone-500"> · {entry.detail}</span>}
                  </td>
                  <td className="hidden px-4 py-2.5 sm:table-cell">
                    <code className="font-mono text-xs text-stone-500">{short(entry.hash)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
