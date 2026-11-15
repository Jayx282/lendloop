"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { categoryLabel, conditionLabel } from "@/convex/lib/constants";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AvailabilityBadge } from "@/components/loan-bits";
import { useToast } from "@/components/providers/ToastProvider";
import { ToolFormDialog, type ToolDraft } from "@/components/ToolFormDialog";
import { Badge, Button, Card, EmptyState, PageHeader, PageSpinner } from "@/components/ui";
import { useMutationState } from "@/lib/useMutationState";

type MyTool = FunctionReturnType<typeof api.tools.mine>[number];

export default function MyListingsPage() {
  const tools = useQuery(api.tools.mine);
  const [editing, setEditing] = useState<ToolDraft | null>(null);
  const [deleting, setDeleting] = useState<MyTool | null>(null);
  const remove = useMutationState(api.tools.remove);
  const toast = useToast();

  return (
    <>
      <PageHeader
        title="My listings"
        description="Tools you lend. Only you can edit or delete them."
        actions={
          <Button onClick={() => setEditing({ name: "", category: "power-tools", condition: "good", description: "" })}>
            List a tool
          </Button>
        }
      />

      {tools === undefined ? (
        <PageSpinner label="Loading your listings" />
      ) : tools.length === 0 ? (
        <EmptyState title="You haven't listed anything yet">
          That ladder in the garage? Somebody nearby needs it for an afternoon.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {tools.map((tool) => (
            <Card key={tool._id} className="flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{tool.name}</h2>
                  <Badge>{categoryLabel(tool.category)}</Badge>
                  <AvailabilityBadge availability={tool.availability} />
                </div>
                <p className="mt-1 text-sm text-stone-600">
                  {conditionLabel(tool.condition)}
                  {tool.description && ` · ${tool.description}`}
                </p>
                {tool.pendingRequests > 0 && (
                  <Link
                    href="/incoming"
                    className="mt-1 inline-block text-sm font-medium text-emerald-700 hover:underline"
                  >
                    {tool.pendingRequests} pending request{tool.pendingRequests === 1 ? "" : "s"} →
                  </Link>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setEditing({
                      _id: tool._id,
                      name: tool.name,
                      category: tool.category,
                      condition: tool.condition,
                      description: tool.description,
                    })
                  }
                >
                  Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => setDeleting(tool)}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ToolFormDialog tool={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name}”?`}
        confirmLabel="Delete listing"
        pending={remove.pending}
        error={remove.error}
        onClose={() => {
          remove.clearError();
          setDeleting(null);
        }}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await remove.run({ toolId: deleting._id });
          if (result.ok) {
            toast("Listing deleted");
            setDeleting(null);
          }
        }}
      >
        It disappears from the board, and anyone waiting on a request is told it was declined. Past loans stay in your
        history.
      </ConfirmDialog>
    </>
  );
}
