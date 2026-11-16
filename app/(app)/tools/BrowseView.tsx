"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, categoryLabel, conditionLabel, type Category } from "@/convex/lib/constants";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AvailabilityBadge } from "@/components/loan-bits";
import { useToast } from "@/components/providers/ToastProvider";
import { useViewer } from "@/components/providers/ViewerProvider";
import { RequestDialog } from "@/components/RequestDialog";
import { Badge, Button, Card, EmptyState, PageHeader, PageSpinner, TrustedBadge, cx } from "@/components/ui";
import { formatRange } from "@/lib/format";
import { useMutationState } from "@/lib/useMutationState";

type Tool = FunctionReturnType<typeof api.tools.browse>[number];

export function BrowseView() {
  const viewer = useViewer();
  const [category, setCategory] = useState<Category | undefined>(undefined);
  const tools = useQuery(api.tools.browse, { category });
  const [requesting, setRequesting] = useState<Tool | null>(null);
  const [removing, setRemoving] = useState<Tool | null>(null);
  const remove = useMutationState(api.tools.remove);
  const toast = useToast();

  return (
    <>
      <PageHeader title="Browse tools" description="Everything your neighbours lend, with today's availability." />

      <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {[{ value: undefined, label: "All" }, ...CATEGORIES].map((option) => {
          const active = category === option.value;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={active}
              onClick={() => setCategory(option.value as Category | undefined)}
              className={cx(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                active
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-stone-300 bg-white text-stone-700 hover:border-stone-400",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {tools === undefined ? (
        <PageSpinner label="Loading tools" />
      ) : tools.length === 0 ? (
        <EmptyState title={category ? `No ${categoryLabel(category).toLowerCase()} tools yet` : "No tools listed yet"}>
          List something from{" "}
          <Link className="font-medium text-emerald-700 underline" href="/listings">
            My listings
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <Card key={tool._id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold text-stone-900">{tool.name}</h2>
                <Badge>{categoryLabel(tool.category)}</Badge>
              </div>
              <div className="mt-2">
                <AvailabilityBadge availability={tool.availability} />
              </div>
              {tool.description && <p className="mt-3 text-sm text-stone-600">{tool.description}</p>}
              <dl className="mt-3 space-y-1 text-xs text-stone-500">
                <div className="flex gap-1">
                  <dt>Condition:</dt>
                  <dd className="text-stone-700">{conditionLabel(tool.condition)}</dd>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <dt>Lender:</dt>
                  <dd className="flex items-center gap-1.5 text-stone-700">
                    {tool.isMine ? "You" : tool.lender.displayName}
                    {tool.lender.trustedLender && <TrustedBadge />}
                  </dd>
                </div>
              </dl>
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
                {tool.isMine ? (
                  <span className="text-sm text-stone-500">Your listing</span>
                ) : tool.myOpenRequest ? (
                  <span className="text-sm text-stone-600">
                    You {tool.myOpenRequest.status === "approved" ? "have it booked" : "asked for"}{" "}
                    {formatRange(tool.myOpenRequest.startDate, tool.myOpenRequest.endDate)}
                  </span>
                ) : (
                  <Button size="sm" onClick={() => setRequesting(tool)}>
                    Request to borrow
                  </Button>
                )}
                {viewer.role === "admin" && !tool.isMine && (
                  <Button size="sm" variant="ghost" className="ml-auto text-rose-700" onClick={() => setRemoving(tool)}>
                    Remove listing
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <RequestDialog tool={requesting} onClose={() => setRequesting(null)} />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove “${removing?.name}”?`}
        confirmLabel="Remove listing"
        pending={remove.pending}
        error={remove.error}
        onClose={() => {
          remove.clearError();
          setRemoving(null);
        }}
        onConfirm={async () => {
          if (!removing) return;
          const result = await remove.run({ toolId: removing._id });
          if (result.ok) {
            toast("Listing removed");
            setRemoving(null);
          }
        }}
      >
        As an admin you can remove any listing. Pending requests are declined and the borrowers are told by email. The
        action is recorded in the audit log.
      </ConfirmDialog>
    </>
  );
}
