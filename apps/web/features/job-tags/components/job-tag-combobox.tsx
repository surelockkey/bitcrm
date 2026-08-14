"use client";

import { useState } from "react";
import { ArrowUpDown, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { JobTag } from "@bitcrm/types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDeleteJobTag, useJobTags } from "../hooks";
import { activeJobTags, jobTagMap, tagColorClasses } from "../lib";
import { JobTagFormDialog } from "./job-tag-form-dialog";

/**
 * Job-tag picker, mirroring the Workiz tag window so migrating users feel at
 * home: selected tags show as removable colored chips; "+" opens a popover
 * with the catalog count, a "Create new" shortcut, search with a sort toggle,
 * and per-row edit/delete — the whole catalog is manageable from the job
 * itself, not just from Settings (guarded by the job_tags.* permissions).
 */
export function JobTagCombobox({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const { data } = useJobTags();
  const { can } = usePermissions();
  const del = useDeleteJobTag();
  const map = jobTagMap(data);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [alpha, setAlpha] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<JobTag | undefined>();
  const [deleting, setDeleting] = useState<JobTag | undefined>();

  const canCreate = can("job_tags", "create");
  const canEdit = can("job_tags", "edit");
  const canDelete = can("job_tags", "delete");

  const active = activeJobTags(data);
  const listed = alpha ? [...active].sort((a, b) => a.name.localeCompare(b.name)) : active;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const tag = map.get(id);
        return (
          <span
            key={id}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
              tag ? tagColorClasses(tag.color) : "border-border bg-muted/60 text-muted-foreground",
            )}
          >
            {tag?.name ?? id}
            {!disabled ? (
              <button type="button" onClick={() => toggle(id)} className="opacity-70 hover:opacity-100" aria-label={`Remove ${tag?.name ?? "tag"}`}>
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        );
      })}

      {disabled ? (
        value.length === 0 ? <span className="text-sm text-muted-foreground">—</span> : null
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="size-3" /> Add tag
          </button>

          {open ? (
            <>
              <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
              <div className="absolute left-0 top-full z-20 mt-1 w-80 overflow-hidden rounded-lg border bg-popover shadow-md">
                <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
                  <span className="text-sm font-semibold">Available tags ({active.length})</span>
                  {canCreate ? (
                    <button
                      type="button"
                      onClick={() => setCreating(true)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                    >
                      <Plus className="size-3.5" /> Create new
                    </button>
                  ) : null}
                </div>

                <Command loop>
                  <div className="flex items-center gap-1 pr-1">
                    <div className="flex-1">
                      <CommandInput autoFocus placeholder="Search tags…" className="h-9" value={query} onValueChange={setQuery} />
                    </div>
                    <button
                      type="button"
                      aria-label="Sort tags"
                      title={alpha ? "Sorted A→Z" : "Sorted by priority"}
                      onClick={() => setAlpha((a) => !a)}
                      className={cn(
                        "grid size-8 flex-none place-items-center rounded-md hover:bg-muted/60",
                        alpha ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <ArrowUpDown className="size-4" />
                    </button>
                  </div>
                  <CommandList className="max-h-64">
                    <CommandEmpty>No tags found.</CommandEmpty>
                    <CommandGroup>
                      {listed.map((tag) => {
                        const checked = value.includes(tag.id);
                        return (
                          <CommandItem key={tag.id} value={tag.name} onSelect={() => toggle(tag.id)} className="group gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                                tagColorClasses(tag.color),
                              )}
                            >
                              {tag.name}
                            </span>
                            <span className="ml-auto flex items-center gap-0.5">
                              {checked ? <Check className="size-4 text-brand" /> : null}
                              {canDelete ? (
                                <button
                                  type="button"
                                  aria-label={`Delete ${tag.name}`}
                                  onClick={(e) => { e.stopPropagation(); setDeleting(tag); }}
                                  className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              ) : null}
                              {canEdit ? (
                                <button
                                  type="button"
                                  aria-label={`Edit ${tag.name}`}
                                  onClick={(e) => { e.stopPropagation(); setEditing(tag); }}
                                  className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                              ) : null}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>
            </>
          ) : null}

          {creating ? (
            <JobTagFormDialog
              open={creating}
              onOpenChange={setCreating}
              initialName={query.trim()}
              onCreated={(tag) => {
                onChange([...value, tag.id]);
                setOpen(false);
                setQuery("");
              }}
            />
          ) : null}

          {editing ? (
            <JobTagFormDialog
              key={editing.id}
              jobTag={editing}
              open={Boolean(editing)}
              onOpenChange={(v) => !v && setEditing(undefined)}
            />
          ) : null}

          <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete job tag?</AlertDialogTitle>
                <AlertDialogDescription>
                  &ldquo;{deleting?.name}&rdquo; will be removed everywhere. If any job still uses
                  it, it&apos;s archived instead — it leaves the pickers but old jobs keep their label.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (deleting) del.mutate(deleting.id);
                    setDeleting(undefined);
                  }}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
