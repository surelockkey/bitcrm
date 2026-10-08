"use client";

import { useState } from "react";
import { ArrowUpDown, Check, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import type { JobTag } from "@bitcrm/types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
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
import { activeJobTags, jobTagMap, tagColorClasses, tagSolidClasses } from "../lib";
import { JobTagFormDialog } from "./job-tag-form-dialog";

/** Sort orders offered by the picker's "Sort by" menu, as in Workiz. */
const SORT_OPTIONS = [
  { key: "az", label: "A-Z" },
  { key: "za", label: "Z-A" },
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]["key"];

function sortTags(tags: JobTag[], sort: SortKey): JobTag[] {
  const byName = (a: JobTag, b: JobTag) => a.name.localeCompare(b.name);
  const byCreated = (a: JobTag, b: JobTag) => a.createdAt.localeCompare(b.createdAt);
  const sorted = [...tags];
  switch (sort) {
    case "az": return sorted.sort(byName);
    case "za": return sorted.sort((a, b) => byName(b, a));
    case "newest": return sorted.sort((a, b) => byCreated(b, a));
    case "oldest": return sorted.sort(byCreated);
  }
}

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
  variant = "default",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /**
   * `workiz`: the job page header's dress (job_b_02_tags_add) — solid
   * colour chips with the × inside, a bare blue "+" and Workiz's tag window.
   * The jobs list and the new-job form keep the default look.
   */
  variant?: "default" | "workiz";
}) {
  const wz = variant === "workiz";
  const { data, isLoading } = useJobTags();
  const { can } = usePermissions();
  const del = useDeleteJobTag();
  const map = jobTagMap(data);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<JobTag | undefined>();
  const [deleting, setDeleting] = useState<JobTag | undefined>();

  const canCreate = can("job_tags", "create");
  const canEdit = can("job_tags", "edit");
  const canDelete = can("job_tags", "delete");

  const active = activeJobTags(data);
  const listed = sortTags(active, sort);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className={cn("flex flex-wrap items-center", wz ? "gap-1" : "gap-1.5")}>
      {value.map((id) => {
        const tag = map.get(id);
        // Until the catalog loads, a skeleton beats flashing the raw id.
        if (!tag && isLoading) {
          return <span key={id} className="inline-block h-5 w-16 animate-pulse rounded-full bg-muted" />;
        }
        if (wz) {
          // Workiz chip: 24px, solid colour, 14px/500 white, r3, the × in the
          // chip's own right padding (pad 4 24 4 8).
          return (
            <span
              key={id}
              className={cn(
                "relative inline-flex h-6 items-center rounded-[3px] pl-2 text-[14px] leading-4 font-medium",
                disabled ? "pr-2" : "pr-6",
                tag ? tagSolidClasses(tag.color) : "bg-muted text-muted-foreground",
              )}
            >
              {tag?.name ?? id}
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="absolute top-1/2 right-1.5 grid size-3.5 -translate-y-1/2 place-items-center opacity-90 hover:opacity-100"
                  aria-label={`Remove ${tag?.name ?? "tag"}`}
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              ) : null}
            </span>
          );
        }
        return (
          <span
            key={id}
            className={cn(
              "inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-xs font-medium",
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
        value.length === 0 ? <span className={cn("text-muted-foreground", wz ? "text-[13px]" : "text-sm")}>—</span> : null
      ) : (
        <div className={cn("relative", wz && "ml-1")}>
          {wz ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label="Add tag"
              title="Add tag"
              // Workiz: a bare 24px "+" in #3da6e1; hover/open tints it #e5f1ff.
              className="grid size-6 place-items-center rounded-[4px] text-[#3da6e1] hover:bg-accent aria-expanded:bg-accent"
            >
              <Plus className="size-4" strokeWidth={1.5} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 rounded-chip border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <Plus className="size-3" /> Add tag
            </button>
          )}

          {open ? (
            <>
              <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
              <div
                className={cn(
                  "absolute left-0 top-full z-20 overflow-hidden bg-popover",
                  wz
                    ? "w-[338px] rounded-[8px] p-4 shadow-[0_8px_16px_rgba(59,75,82,0.15),0_0_4px_rgba(59,75,82,0.05)]"
                    : "mt-1 w-80 rounded-lg border shadow-md",
                )}
              >
                <div className={cn("flex items-center justify-between", wz ? "pt-1 pb-4" : "px-3 pb-1 pt-2.5")}>
                  <span className={wz ? "text-[16px] leading-6 font-semibold tracking-[0.2px] text-foreground" : "text-sm font-semibold"}>
                    Available tags ({active.length})
                  </span>
                  {canCreate ? (
                    <button
                      type="button"
                      onClick={() => setCreating(true)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:underline",
                        wz ? "text-[13px] leading-[19px] font-semibold text-[#6aa8ee]" : "text-xs font-medium text-brand",
                      )}
                    >
                      <Plus className="size-3.5" /> Create new
                    </button>
                  ) : null}
                </div>

                <Command loop>
                  <div className={cn("flex items-center", wz ? "gap-2.5" : "gap-1 pr-1")}>
                    <div className="flex-1">
                      {wz ? (
                        <div className="relative">
                          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-foreground" />
                          <CommandPrimitive.Input
                            autoFocus
                            placeholder="Search tags"
                            value={query}
                            onValueChange={setQuery}
                            className="h-10 w-full rounded-[4px] border border-[#6aa8ee] bg-white pr-3 pl-11 text-[13px] text-foreground outline-none placeholder:text-[#9ea6aa]"
                          />
                        </div>
                      ) : (
                        <CommandInput autoFocus placeholder="Search tags…" className="h-9" value={query} onValueChange={setQuery} />
                      )}
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Sort by"
                        title="Sort by"
                        aria-expanded={sortOpen}
                        onClick={() => setSortOpen((o) => !o)}
                        className={cn(
                          "grid size-8 flex-none place-items-center rounded-md hover:bg-muted/60 hover:text-foreground",
                          wz ? "text-foreground" : "text-muted-foreground",
                          sortOpen && "bg-muted/60 text-foreground",
                        )}
                      >
                        <ArrowUpDown className={wz ? "size-5" : "size-4"} strokeWidth={wz ? 1.5 : 2} />
                      </button>

                      {sortOpen ? (
                        <>
                          <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setSortOpen(false)} />
                          <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-lg border bg-popover py-1 shadow-md">
                            {SORT_OPTIONS.map((o) => (
                              <button
                                key={o.key}
                                type="button"
                                role="menuitemradio"
                                aria-checked={sort === o.key}
                                onClick={() => { setSort(o.key); setSortOpen(false); }}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60",
                                  sort === o.key && "bg-muted/40",
                                )}
                              >
                                <Check className={cn("size-3.5", sort === o.key ? "opacity-100" : "opacity-0")} />
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <CommandList className={wz ? "mt-4 max-h-[188px]" : "max-h-64"}>
                    <CommandEmpty>No tags found.</CommandEmpty>
                    <CommandGroup className={wz ? "p-0" : undefined}>
                      {listed.map((tag) => {
                        const checked = value.includes(tag.id);
                        return (
                          <CommandItem
                            key={tag.id}
                            value={tag.name}
                            onSelect={() => toggle(tag.id)}
                            className={cn("group gap-2", wz && "h-[35px] px-0 py-0 data-selected:bg-transparent")}
                          >
                            <span
                              className={cn(
                                // Workiz's window lists tags as solid 19px labels (13px/500 white, r4).
                                wz
                                  ? "inline-flex h-[19px] items-center rounded-[4px] px-1 text-[13px] leading-[19px] font-medium"
                                  : "inline-flex items-center rounded-chip border px-2 py-0.5 text-xs font-medium",
                                wz ? tagSolidClasses(tag.color) : tagColorClasses(tag.color),
                              )}
                            >
                              {tag.name}
                            </span>
                            {/* CommandShortcut pins the actions to the row's right edge and
                                suppresses the wrapper's own trailing ml-auto check icon,
                                which would otherwise split the free space with us. */}
                            <CommandShortcut className="flex items-center gap-0.5 tracking-normal">
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
                            </CommandShortcut>
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
