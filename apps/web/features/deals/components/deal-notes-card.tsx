"use client";

import { cloneElement, useId } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The job's note — one box, the way Workiz has it.
 *
 * There used to be a second, dispatcher-only box. That was ours alone: what
 * Workiz's teams use for the same thing is a custom field they made themselves
 * ("Manager Note", in their Dispatchers group), and our own field was empty on
 * all 80,034 imported jobs. Two boxes only left people wondering which one the
 * job note was.
 *
 * The card is dumb: it renders the parent's draft value and reports keystrokes
 * back — the job page's single Save persists it (trimmed there).
 */
export function DealNotesCard({
  notes,
  editable,
  onNotesChange,
}: {
  notes: string;
  editable: boolean;
  onNotesChange: (v: string) => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Notes</h2>

      {editable ? (
        <Field label="Job note">
          <Textarea
            rows={4}
            value={notes}
            placeholder="What needs doing…"
            onChange={(e) => onNotesChange(e.target.value)}
          />
        </Field>
      ) : (
        <div className="space-y-2">
          <NoteBlock label="Job note" value={notes} />
          <p className="text-[11px] text-muted-foreground">Notes are managed by dispatch.</p>
        </div>
      )}
    </section>
  );
}

/**
 * The hint sits outside the label and is attached with `aria-describedby`:
 * inside it, "Internal — technicians can't edit this." became part of the
 * field's name, so the two notes were no longer told apart by name.
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string }>;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="block">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {cloneElement(children, { id, ...(hint ? { "aria-describedby": hintId } : {}) })}
      {hint ? (
        <span id={hintId} className="mt-1 block text-[11px] text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function NoteBlock({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <p className={cn("whitespace-pre-wrap text-sm", value ? "text-foreground/90" : "text-muted-foreground/60 italic")}>
        {value?.trim() ? value : "—"}
      </p>
    </div>
  );
}
