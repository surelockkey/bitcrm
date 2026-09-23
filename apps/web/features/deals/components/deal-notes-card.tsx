"use client";

import { cloneElement, useId } from "react";
import { Lock } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * Deal notes. Dispatchers / management edit both the shared note and an
 * internal (dispatcher-only) note; technicians see them read-only. The card is
 * dumb: it renders the parent's draft values and reports keystrokes back — the
 * job page's single Save button persists them (trimmed there).
 */
export function DealNotesCard({
  notes,
  internalNotes,
  editable,
  onNotesChange,
  onInternalNotesChange,
}: {
  notes: string;
  internalNotes: string;
  editable: boolean;
  onNotesChange: (v: string) => void;
  onInternalNotesChange: (v: string) => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">Notes</h2>

      {editable ? (
        <div className="space-y-3">
          <Field label="Job note">
            <Textarea rows={3} value={notes} placeholder="Notes visible to the team…" onChange={(e) => onNotesChange(e.target.value)} />
          </Field>
          <Field label="Dispatcher note" hint="Internal — technicians can't edit this.">
            <Textarea rows={3} value={internalNotes} placeholder="Internal dispatcher notes…" onChange={(e) => onInternalNotesChange(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <NoteBlock label="Job note" value={notes} />
          <NoteBlock label="Dispatcher note" value={internalNotes} tone="warn" icon={<Lock className="size-3" />} />
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
  tone,
  icon,
}: {
  label: string;
  value?: string;
  tone?: "warn";
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          "mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide",
          tone === "warn" ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground",
        )}
      >
        {label} {icon}
      </div>
      <p className={cn("whitespace-pre-wrap text-sm", value ? "text-foreground/90" : "text-muted-foreground/60 italic")}>
        {value?.trim() ? value : "—"}
      </p>
    </div>
  );
}
