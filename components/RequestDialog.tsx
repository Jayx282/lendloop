"use client";

import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/constants";
import { useToast } from "@/components/providers/ToastProvider";
import { Button, Dialog, ErrorText, Field, inputClass } from "@/components/ui";
import { loanDays, localToday } from "@/lib/format";
import { useMutationState } from "@/lib/useMutationState";

export function RequestDialog({
  tool,
  onClose,
}: {
  tool: { _id: Id<"tools">; name: string; lender: { displayName: string } } | null;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState(localToday());
  const [endDate, setEndDate] = useState(localToday(2));
  const [note, setNote] = useState("");
  const { run, pending, error, clearError } = useMutationState(api.loans.request);
  const toast = useToast();

  const close = () => {
    clearError();
    setNote("");
    onClose();
  };
  const days = endDate >= startDate ? loanDays(startDate, endDate) : 0;

  return (
    <Dialog
      open={tool !== null}
      onClose={close}
      title={tool ? `Borrow ${tool.name}` : ""}
      description={tool ? `${tool.lender.displayName} will get an email and can approve or decline.` : undefined}
    >
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!tool) return;
          const result = await run({ toolId: tool._id, startDate, endDate, note: note.trim() || undefined });
          if (result.ok) {
            toast(`Request sent to ${tool.lender.displayName}`);
            close();
          }
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" htmlFor="start">
            <input
              id="start"
              type="date"
              required
              min={localToday()}
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="Until (return by)" htmlFor="end">
            <input
              id="end"
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <p className="text-xs text-stone-500">
          {days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "Pick an end date on or after the start date"}
          {" · "}up to {LIMITS.maxLoanDays} days
        </p>
        <Field label="Note for the lender (optional)" htmlFor="note" hint={`${note.length}/${LIMITS.note.max}`}>
          <textarea
            id="note"
            rows={3}
            maxLength={LIMITS.note.max}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What it's for, when you'd pick it up…"
            className={inputClass}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" pending={pending}>
            Send request
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
