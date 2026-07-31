"use client";

import { useMemo, useState } from "react";
import { Loader2, Merge } from "lucide-react";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMergeContacts } from "../hooks";
import {
  contactName,
  findDuplicateGroups,
  formatPhone,
  type DuplicateCriterion,
} from "../lib";

const CRITERIA: { value: DuplicateCriterion; label: string }[] = [
  { value: "phone", label: "Phone" },
  { value: "address", label: "Address" },
  { value: "name", label: "Name" },
];

/** Backend caps a merge at a primary + 4 duplicates. */
const MAX_MERGE = 5;

export function MergeContactsDialog({
  open,
  onOpenChange,
  contacts,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contacts: Contact[];
}) {
  const [criterion, setCriterion] = useState<DuplicateCriterion>("phone");
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const merge = useMergeContacts();

  const groups = useMemo(
    () => findDuplicateGroups(contacts, criterion),
    [contacts, criterion],
  );
  const group = groups.find((g) => g.key === groupKey) ?? null;

  const switchCriterion = (c: DuplicateCriterion) => {
    setCriterion(c);
    setGroupKey(null);
  };

  const openGroup = (key: string) => {
    const g = groups.find((x) => x.key === key);
    if (!g) return;
    const preselected = g.contacts.slice(0, MAX_MERGE).map((c) => c.id);
    setGroupKey(key);
    setSelectedIds(preselected);
    setPrimaryId(preselected[0] ?? null);
  };

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      const next = selectedIds.filter((x) => x !== id);
      setSelectedIds(next);
      if (primaryId === id) setPrimaryId(next[0] ?? null);
    } else if (selectedIds.length < MAX_MERGE) {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const canMerge = Boolean(primaryId) && selectedIds.length >= 2 && !merge.isPending;

  const submit = () => {
    if (!primaryId) return;
    merge.mutate(
      { primaryId, mergeIds: selectedIds.filter((x) => x !== primaryId) },
      {
        onSuccess: () => {
          setGroupKey(null);
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge contacts</DialogTitle>
          <DialogDescription>
            Find duplicates by phone, address or name, then fold up to five
            duplicates into a single contact.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1">
          {CRITERIA.map((c) => (
            <Button
              key={c.value}
              type="button"
              size="sm"
              variant={criterion === c.value ? "secondary" : "ghost"}
              onClick={() => switchCriterion(c.value)}
            >
              {c.label}
            </Button>
          ))}
        </div>

        {group === null ? (
          groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No duplicates found for this criterion.
            </p>
          ) : (
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => openGroup(g.key)}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="font-medium">{g.label}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {g.contacts.length} contacts
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="self-start text-sm text-muted-foreground hover:underline"
              onClick={() => setGroupKey(null)}
            >
              ← Back to duplicates
            </button>
            {group.contacts.map((c) => {
              const checked = selectedIds.includes(c.id);
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <Checkbox
                    aria-label={contactName(c)}
                    checked={checked}
                    disabled={!checked && selectedIds.length >= MAX_MERGE}
                    onCheckedChange={() => toggle(c.id)}
                  />
                  <div className="flex-1">
                    <div className="font-medium">{contactName(c)}</div>
                    <div className="text-muted-foreground">
                      {c.phones.map(formatPhone).join(" · ") || "—"}
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name="merge-primary"
                      aria-label={`Primary: ${contactName(c)}`}
                      checked={primaryId === c.id}
                      disabled={!checked}
                      onChange={() => setPrimaryId(c.id)}
                    />
                    Primary
                  </label>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              The primary contact survives; the others are folded into it and
              archived. Their deals move to the primary automatically.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {group ? (
            <Button
              type="button"
              variant="brand"
              className="gap-1.5"
              disabled={!canMerge}
              onClick={submit}
            >
              {merge.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Merge className="size-4" />
              )}
              Merge {selectedIds.length} {selectedIds.length === 1 ? "contact" : "contacts"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
