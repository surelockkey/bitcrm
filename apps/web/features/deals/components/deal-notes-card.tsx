"use client";

import { useState } from "react";
import { Loader2, Lock, Pencil } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useUpdateDeal } from "../hooks";

/**
 * Deal notes. Dispatchers / management edit both the shared note and an
 * internal (dispatcher-only) note; technicians see them read-only.
 */
export function DealNotesCard({ deal }: { deal: Deal }) {
  const { can, isTechnician } = usePermissions();
  const update = useUpdateDeal(deal.id);
  const editable = can("deals", "edit") && !isTechnician;

  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(deal.notes ?? "");
  const [internalNotes, setInternalNotes] = useState(deal.internalNotes ?? "");

  const start = () => {
    setNotes(deal.notes ?? "");
    setInternalNotes(deal.internalNotes ?? "");
    setEditing(true);
  };

  const save = () => {
    update.mutate(
      { notes: notes.trim(), internalNotes: internalNotes.trim() },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Notes</h2>
        {editable && !editing ? (
          <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={start}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-3">
          <Field label="Note">
            <Textarea rows={3} value={notes} placeholder="Notes visible to the team…" onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Dispatcher note" hint="Internal — technicians can't edit this.">
            <Textarea rows={3} value={internalNotes} placeholder="Internal dispatcher notes…" onChange={(e) => setInternalNotes(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={update.isPending} onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="brand" size="sm" className="gap-1.5" disabled={update.isPending} onClick={save}>
              {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <NoteBlock label="Note" value={deal.notes} />
          <NoteBlock
            label="Dispatcher note"
            value={deal.internalNotes}
            tone="warn"
            icon={!editable ? <Lock className="size-3" /> : undefined}
          />
          {!editable ? (
            <p className="text-[11px] text-muted-foreground">Notes are managed by dispatch.</p>
          ) : null}
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
