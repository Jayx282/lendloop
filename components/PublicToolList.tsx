"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORIES, categoryLabel } from "@/convex/lib/constants";
import { EmptyState, Spinner } from "@/components/ui";

/** Read-only and public: the query returns tool names and categories, nothing else. */
export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic);

  if (tools === undefined) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-stone-500" role="status">
        <Spinner className="size-4" /> Loading tools…
      </div>
    );
  }
  if (tools.length === 0) {
    return <EmptyState title="Nothing listed yet">Be the first to lend something.</EmptyState>;
  }

  const groups = CATEGORIES.map((category) => ({
    ...category,
    tools: tools.filter((tool) => tool.category === category.value),
  })).filter((group) => group.tools.length > 0);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((group) => (
        <div key={group.value} className="rounded-xl border border-stone-200 bg-white p-5">
          <h3 className="flex items-center justify-between text-sm font-semibold text-stone-500">
            {categoryLabel(group.value)}
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
              {group.tools.length}
            </span>
          </h3>
          <ul className="mt-3 space-y-1.5">
            {group.tools.map((tool, index) => (
              <li key={`${tool.name}-${index}`} className="text-stone-800">
                {tool.name}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
