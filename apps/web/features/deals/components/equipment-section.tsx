"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, Wrench } from "lucide-react";
import type { DealEquipment, DealEquipmentInput } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateEquipment, useDeleteEquipment, useEquipment, useUpdateEquipment } from "../equipment-hooks";
import type { EquipmentPatch } from "../equipment-api";

type FormKey = keyof DealEquipmentInput;

/** Workiz's "Add equipment" form, field for field and in its order. */
const FIELDS: { key: FormKey; label: string; type?: "date" | "textarea" }[] = [
  { key: "name", label: "Equipment name" },
  { key: "model", label: "Model #" },
  { key: "brand", label: "Brand (optional)" },
  { key: "laborWarrantyUntil", label: "Labor warranty valid thru (optional)", type: "date" },
  { key: "manufacturerWarrantyUntil", label: "Manufacturer warranty valid thru (optional)", type: "date" },
  { key: "serial", label: "Serial # (optional)" },
  { key: "installedOn", label: "Installation date (optional)", type: "date" },
  { key: "propertyAddress", label: "Property address (optional)" },
  { key: "locationInProperty", label: "Location in property (optional)" },
  { key: "notes", label: "Notes (optional)", type: "textarea" },
];

type Draft = Record<FormKey, string>;

const draftOf = (eq?: DealEquipment): Draft =>
  Object.fromEntries(FIELDS.map((f) => [f.key, (eq?.[f.key] as string | undefined) ?? ""])) as Draft;

/** "Sep 29, 2027" from "2027-09-29", read as a calendar day. */
function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The equipment on a job, as Workiz keeps it: one row a piece with what
 * identifies it, "Add equipment" opening Workiz's form (name and model
 * required), edit and remove on the row. Technicians add it from the phone;
 * the office sees and corrects it here.
 */
export function EquipmentSection({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const { data: items = [], isLoading } = useEquipment(dealId);
  const create = useCreateEquipment(dealId);
  const update = useUpdateEquipment(dealId);
  const remove = useDeleteEquipment(dealId);
  const [editing, setEditing] = useState<DealEquipment | "new" | null>(null);
  const [removing, setRemoving] = useState<DealEquipment | null>(null);

  return (
    <div className="space-y-2">
      {isLoading ? null : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No equipment added</p>
      ) : (
        <div className="divide-y">
          {items.map((eq) => (
            <EquipmentRow
              key={eq.id}
              eq={eq}
              onEdit={canEdit ? () => setEditing(eq) : undefined}
              onRemove={canEdit ? () => setRemoving(eq) : undefined}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          Add equipment
        </Button>
      ) : null}

      {editing ? (
        <EquipmentDialog
          initial={editing === "new" ? undefined : editing}
          busy={create.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            const done = { onSuccess: () => setEditing(null) };
            if (editing === "new") {
              const body = Object.fromEntries(
                Object.entries(draft).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]),
              ) as unknown as DealEquipmentInput;
              create.mutate(body, done);
            } else {
              // Only what changed; an emptied optional field is cleared.
              const before = draftOf(editing);
              const body: EquipmentPatch = {};
              for (const f of FIELDS) {
                const v = draft[f.key].trim();
                if (v === before[f.key]) continue;
                (body as Record<string, string | null>)[f.key] = v || null;
              }
              update.mutate({ equipmentId: editing.id, body }, done);
            }
          }}
        />
      ) : null}

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove equipment</DialogTitle>
            <DialogDescription>{removing ? `${removing.name} will be taken off this job.` : null}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (removing) remove.mutate(removing.id);
                setRemoving(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EquipmentRow({ eq, onEdit, onRemove }: { eq: DealEquipment; onEdit?: () => void; onRemove?: () => void }) {
  const lines = [
    eq.serial ? `Serial # ${eq.serial}` : null,
    eq.installedOn ? `Installed ${formatDay(eq.installedOn)}` : null,
    eq.laborWarrantyUntil ? `Labor warranty until ${formatDay(eq.laborWarrantyUntil)}` : null,
    eq.manufacturerWarrantyUntil ? `Manufacturer warranty until ${formatDay(eq.manufacturerWarrantyUntil)}` : null,
    [eq.locationInProperty, eq.propertyAddress].filter(Boolean).join(" · ") || null,
  ].filter(Boolean);

  return (
    <div data-testid={`equipment-${eq.id}`} className="flex items-start gap-3 py-2">
      <Wrench className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{eq.name}</p>
        <p className="text-sm text-muted-foreground">{[eq.brand, eq.model].filter(Boolean).join(" · ")}</p>
        {lines.map((l) => (
          <p key={l} className="text-xs text-muted-foreground">
            {l}
          </p>
        ))}
        {eq.notes ? <p className="mt-1 whitespace-pre-wrap text-xs">{eq.notes}</p> : null}
      </div>
      {onEdit ? (
        <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${eq.name}`} onClick={onEdit}>
          <Pencil className="size-4" />
        </Button>
      ) : null}
      {onRemove ? (
        <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${eq.name}`} onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function EquipmentDialog({
  initial,
  busy,
  onClose,
  onSave,
}: {
  initial?: DealEquipment;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const ready = draft.name.trim() !== "" && draft.model.trim() !== "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit equipment" : "Add equipment"}</DialogTitle>
          <DialogDescription>Name and model are required; the property address defaults to the job’s.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) onSave(draft);
          }}
        >
          {FIELDS.map((f) => {
            const id = `equipment-${f.key}`;
            const onChange = (v: string) => setDraft((d) => ({ ...d, [f.key]: v }));
            return (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={id}>{f.label}</Label>
                {f.type === "textarea" ? (
                  <Textarea id={id} value={draft[f.key]} onChange={(e) => onChange(e.target.value)} rows={3} />
                ) : (
                  <Input id={id} type={f.type ?? "text"} value={draft[f.key]} onChange={(e) => onChange(e.target.value)} />
                )}
              </div>
            );
          })}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
