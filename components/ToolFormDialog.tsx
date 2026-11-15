"use client";

import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CATEGORIES, CONDITIONS, LIMITS, type Category, type Condition } from "@/convex/lib/constants";
import { useToast } from "@/components/providers/ToastProvider";
import { Button, Dialog, ErrorText, Field, inputClass } from "@/components/ui";
import { useMutationState } from "@/lib/useMutationState";

export type ToolDraft = {
  _id?: Id<"tools">;
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

const EMPTY: ToolDraft = { name: "", category: "power-tools", condition: "good", description: "" };

/** Create (no `_id`) or edit (with `_id`) a listing. `tool === null` keeps the dialog closed. */
export function ToolFormDialog({ tool, onClose }: { tool: ToolDraft | null; onClose: () => void }) {
  return (
    <Dialog open={tool !== null} onClose={onClose} title={tool?._id ? "Edit listing" : "List a tool"}>
      {/* Mounted fresh each time the dialog opens, so the form starts from `tool`. */}
      {tool && <ToolForm initial={tool} onDone={onClose} />}
    </Dialog>
  );
}

function ToolForm({ initial, onDone }: { initial: ToolDraft; onDone: () => void }) {
  const [draft, setDraft] = useState<ToolDraft>({ ...EMPTY, ...initial });
  const create = useMutationState(api.tools.create);
  const update = useMutationState(api.tools.update);
  const toast = useToast();
  const editing = Boolean(initial._id);
  const { pending, error } = editing ? update : create;
  const close = onDone;
  const set = <K extends keyof ToolDraft>(key: K, value: ToolDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const fields = {
          name: draft.name,
          category: draft.category,
          condition: draft.condition,
          description: draft.description,
        };
        const result = draft._id ? await update.run({ toolId: draft._id, ...fields }) : await create.run(fields);
        if (result.ok) {
          toast(editing ? "Listing updated" : "Tool listed");
          close();
        }
      }}
    >
      <Field label="Name" htmlFor="tool-name">
        <input
          id="tool-name"
          required
          minLength={LIMITS.toolName.min}
          maxLength={LIMITS.toolName.max}
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Cordless drill"
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" htmlFor="tool-category">
          <select
            id="tool-category"
            value={draft.category}
            onChange={(e) => set("category", e.target.value as Category)}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Condition" htmlFor="tool-condition">
          <select
            id="tool-condition"
            value={draft.condition}
            onChange={(e) => set("condition", e.target.value as Condition)}
            className={inputClass}
          >
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        label="Short description"
        htmlFor="tool-description"
        hint={`${draft.description.length}/${LIMITS.description.max} · Don't include your address or phone number.`}
      >
        <textarea
          id="tool-description"
          rows={3}
          maxLength={LIMITS.description.max}
          value={draft.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Two batteries and a bit set included."
          className={inputClass}
        />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" pending={pending}>
          {editing ? "Save changes" : "List tool"}
        </Button>
      </div>
    </form>
  );
}
