"use client";

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
          <Field label="Note">
            <Textarea rows={3} value={notes} placeholder="Notes visible to the team…" onChange={(e) => onNotesChange(e.target.value)} />
          </Field>
          <Field label="Dispatcher note" hint="Internal — technicians can't edit this.">
            <Textarea rows={3} value={internalNotes} placeholder="Internal dispatcher notes…" onChange={(e) => onInternalNotesChange(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <NoteBlock label="Note" value={notes} />
          <NoteBlock label="Dispatcher note" value={internalNotes} tone="warn" icon={<Lock className="size-3" />} />
          <p className="text-[11px] text-muted-foreground">Notes are managed by dispatch.</p>
        </div>
      )}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
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
