"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useCreateCatalogEntry, useUpdateCatalogEntry } from "../hooks";
import type { CatalogUpdateBody } from "../api";
import type { CatalogConfig, CatalogRow } from "./catalog-tab";

/** The API's cap on a catalog name. */
const NAME_MAX = 120;

function nameError(name: string): string | null {
  if (!name) return "Name is required";
  if (name.length > NAME_MAX) return `Must be ${NAME_MAX} characters or fewer`;
  return null;
}

/**
 * New / Edit popup for one catalog row: its name and whether it's offered.
 * The API holds nothing else for a category or a brand — no parent, no
 * description.
 *
 * `entry` undefined while the catalog loads; `null` for an id it doesn't hold.
 */
export function CatalogDialog({
  config,
  mode,
  entry,
  canSave,
  onClose,
}: {
  config: CatalogConfig;
  mode: "new" | "edit";
  entry?: CatalogRow | null;
  /** The caller's create (new) or edit (edit) permission. */
  canSave: boolean;
  onClose: () => void;
}) {
  const loading = mode === "edit" && entry === undefined;
  const missing = mode === "edit" && entry === null;
  const title = missing
    ? `${config.Noun} not found`
    : mode === "new"
      ? `New ${config.noun}`
      : canSave
        ? `Edit ${config.noun}`
        : config.Noun;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {missing ? "It may have been deleted." : config.description}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div data-testid="catalog-dialog-loading" className="space-y-4 py-1">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : missing ? (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        ) : (
          <CatalogForm
            key={entry?.id ?? "new"}
            config={config}
            entry={entry ?? null}
            canSave={canSave}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CatalogForm({
  config,
  entry,
  canSave,
  onClose,
}: {
  config: CatalogConfig;
  entry: CatalogRow | null;
  canSave: boolean;
  onClose: () => void;
}) {
  const create = useCreateCatalogEntry(config.kind);
  const update = useUpdateCatalogEntry(config.kind);
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(entry?.name ?? "");
  const [active, setActive] = useState(entry?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const renamed = entry !== null && trimmed !== "" && trimmed !== entry.name;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = nameError(trimmed);
    if (problem) return setError(problem);
    setError(null);

    if (entry === null) {
      create.mutate({ name: trimmed, active }, { onSuccess: onClose });
      return;
    }
    // Only what changed: a PUT with the old name would re-run the uniqueness check for nothing.
    const body: CatalogUpdateBody = {};
    if (renamed) body.name = trimmed;
    if (active !== entry.active) body.active = active;
    if (Object.keys(body).length === 0) return onClose();
    update.mutate({ id: entry.id, body }, { onSuccess: onClose });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="catalog-name">Name</Label>
        <Input
          id="catalog-name"
          className="h-9"
          value={name}
          disabled={!canSave}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {renamed && config.renameHint ? (
          <p className="text-xs text-muted-foreground">{config.renameHint(entry.name)}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
        <div>
          <Label htmlFor="catalog-active">Active</Label>
          <p className="text-xs text-muted-foreground">{config.activeHint}</p>
        </div>
        <Switch id="catalog-active" checked={active} disabled={!canSave} onCheckedChange={setActive} />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {canSave ? "Cancel" : "Close"}
        </Button>
        {canSave ? (
          <Button type="submit" disabled={pending} className="gap-1.5">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {entry === null ? "Create" : "Save"}
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  );
}
