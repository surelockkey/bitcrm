"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { CallTag } from "@bitcrm/types";
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
import { useArchiveCallTag, useCallTags } from "../hooks";
import { activeCallTags, callTagMap, tagColorClasses } from "../lib";
import { CallTagChips } from "./call-tag-chips";
import { CallTagFormDialog } from "./call-tag-form-dialog";

/** Sort orders offered by the picker's "Sort by" menu, as in Workiz. */
const SORT_OPTIONS = [
  { key: "az", label: "A-Z" },
  { key: "za", label: "Z-A" },
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]["key"];

/** The panel's own size (w-80, header + search + max-h-64 list). */
const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 340;
/** Breathing room against the trigger and the viewport edges. */
const GAP = 4;
const EDGE = 8;

/**
 * The picker panel, floated out of the page flow and pinned to its trigger.
 *
 * In the call log this lives in a table cell, and the table wrapper is
 * `overflow-x-auto` — which per the CSS overflow spec computes the vertical
 * axis to `auto` as well, so a panel positioned inside the cell is clipped by
 * the table box. It bites hardest on the last rows on screen, which is exactly
 * where a dispatcher triages the oldest calls. Rendering into the body keeps
 * the panel whole, and measuring the trigger lets it flip above when there is
 * no room below.
 *
 * Clicks still reach the caller's handlers: a React portal bubbles events
 * through the tree it was rendered in, not the DOM it was placed in, so the
 * row-click guard above keeps working.
 */
function FloatingPanel({
  anchor,
  onClose,
  children,
}: {
  anchor: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [placement, setPlacement] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const flip = below < PANEL_HEIGHT && rect.top > below;
      setPlacement({
        left: Math.max(
          EDGE,
          Math.min(rect.left, window.innerWidth - PANEL_WIDTH - EDGE),
        ),
        ...(flip
          ? { bottom: window.innerHeight - rect.top + GAP }
          : { top: rect.bottom + GAP }),
      });
    };
    place();
    // Pinned to the viewport, so anything that moves the trigger moves it too
    // — including a scroll inside the table itself (hence capture).
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        aria-label="Close"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        style={{ position: "fixed", ...placement }}
        className="z-50 w-80 overflow-hidden rounded-lg border bg-popover shadow-md"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

function sortTags(tags: CallTag[], sort: SortKey): CallTag[] {
  const byName = (a: CallTag, b: CallTag) => a.name.localeCompare(b.name);
  const byCreated = (a: CallTag, b: CallTag) =>
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  const sorted = [...tags];
  switch (sort) {
    case "az":
      return sorted.sort(byName);
    case "za":
      return sorted.sort((a, b) => byName(b, a));
    case "newest":
      return sorted.sort((a, b) => byCreated(b, a));
    case "oldest":
      return sorted.sort(byCreated);
  }
}

/**
 * The tags on one call: removable colored chips plus an "Add tag" popover with
 * the catalog count, search, a sort toggle, and — for someone who may edit
 * telephony settings — inline create/rename/archive. Mirrors the Workiz tag
 * window, and the job-tag picker it sits beside in the call log.
 *
 * `onChange` receives the whole next list; the caller turns that into the
 * add/remove delta `PATCH /calls/:sid/tags` expects, so two dispatchers
 * clearing a spam queue never overwrite each other.
 */
export function CallTagCombobox({
  value,
  onChange,
  disabled,
  /** Rendered inside a clickable row — keep clicks from reaching it. */
  stopPropagation,
  /** Skip the catalog request when the viewer cannot read it (403). */
  catalogEnabled = true,
  className,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  stopPropagation?: boolean;
  catalogEnabled?: boolean;
  className?: string;
}) {
  const { data, isLoading } = useCallTags(catalogEnabled);
  const { can } = usePermissions();
  const archive = useArchiveCallTag();
  const map = callTagMap(data);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [sortOpen, setSortOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CallTag | undefined>();
  const [archiving, setArchiving] = useState<CallTag | undefined>();

  // The catalog is telephony configuration: one grant covers create, rename
  // and archive, exactly as the server has it (`settings.edit`).
  const canManage = can("settings", "edit");

  const active = activeCallTags(data);
  const listed = sortTags(active, sort);

  const toggle = (id: string) =>
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id],
    );

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {/* Read-only is the plain chip row — the same one the rest of the app
          renders — so there is one answer to what a call's tags look like. */}
      {disabled ? (
        <CallTagChips ids={value} enabled={catalogEnabled} />
      ) : (
        value.map((id) => {
          const tag = map.get(id);
          // Until the catalog loads, a skeleton beats flashing the raw id.
          if (!tag && isLoading) {
            return (
              <span
                key={id}
                className="inline-block h-5 w-16 animate-pulse rounded-full bg-muted"
              />
            );
          }
          return (
            <span
              key={id}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                tag
                  ? tagColorClasses(tag.color)
                  : "border-border bg-muted/60 text-muted-foreground",
                tag && !tag.active && "opacity-60",
              )}
            >
              {tag?.name ?? id}
              <button
                type="button"
                onClick={() => toggle(id)}
                className="opacity-70 hover:opacity-100"
                aria-label={`Remove ${tag?.name ?? "tag"}`}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })
      )}

      {disabled ? (
        value.length === 0 ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : null
      ) : (
        <div className="relative">
          <button
            type="button"
            ref={trigger}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="size-3" /> Add tag
          </button>

          {open ? (
            <FloatingPanel anchor={trigger} onClose={() => setOpen(false)}>
              <>
                <div className="flex items-center justify-between px-3 pb-1 pt-2.5">
                  <span className="text-sm font-semibold">
                    Available tags ({active.length})
                  </span>
                  {canManage ? (
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
                      <CommandInput
                        autoFocus
                        placeholder="Search tags…"
                        className="h-9"
                        value={query}
                        onValueChange={setQuery}
                      />
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        aria-label="Sort by"
                        title="Sort by"
                        aria-expanded={sortOpen}
                        onClick={() => setSortOpen((o) => !o)}
                        className={cn(
                          "grid size-8 flex-none place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          sortOpen && "bg-muted/60 text-foreground",
                        )}
                      >
                        <ArrowUpDown className="size-4" />
                      </button>

                      {sortOpen ? (
                        <>
                          <button
                            type="button"
                            aria-label="Close"
                            className="fixed inset-0 z-30 cursor-default"
                            onClick={() => setSortOpen(false)}
                          />
                          <div
                            role="menu"
                            className="absolute right-0 top-full z-40 mt-1 w-40 overflow-hidden rounded-lg border bg-popover py-1 shadow-md"
                          >
                            {SORT_OPTIONS.map((o) => (
                              <button
                                key={o.key}
                                type="button"
                                role="menuitemradio"
                                aria-checked={sort === o.key}
                                onClick={() => {
                                  setSort(o.key);
                                  setSortOpen(false);
                                }}
                                className={cn(
                                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60",
                                  sort === o.key && "bg-muted/40",
                                )}
                              >
                                <Check
                                  className={cn(
                                    "size-3.5",
                                    sort === o.key ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <CommandList className="max-h-64">
                    <CommandEmpty>No tags found.</CommandEmpty>
                    <CommandGroup>
                      {listed.map((tag) => {
                        const checked = value.includes(tag.id);
                        return (
                          <CommandItem
                            key={tag.id}
                            value={tag.name}
                            onSelect={() => toggle(tag.id)}
                            className="group gap-2"
                          >
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                                tagColorClasses(tag.color),
                              )}
                            >
                              {tag.name}
                            </span>
                            {/* CommandShortcut pins the actions to the row's right edge
                                and suppresses the wrapper's own trailing check icon. */}
                            <CommandShortcut className="flex items-center gap-0.5 tracking-normal">
                              {checked ? (
                                <Check className="size-4 text-brand" />
                              ) : null}
                              {canManage ? (
                                <button
                                  type="button"
                                  aria-label={`Archive ${tag.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setArchiving(tag);
                                  }}
                                  className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              ) : null}
                              {canManage ? (
                                <button
                                  type="button"
                                  aria-label={`Edit ${tag.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditing(tag);
                                  }}
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
              </>
            </FloatingPanel>
          ) : null}

          {creating ? (
            <CallTagFormDialog
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
            <CallTagFormDialog
              key={editing.id}
              callTag={editing}
              open={Boolean(editing)}
              onOpenChange={(v) => !v && setEditing(undefined)}
            />
          ) : null}

          <AlertDialog
            open={Boolean(archiving)}
            onOpenChange={(v) => !v && setArchiving(undefined)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Archive call tag?</AlertDialogTitle>
                <AlertDialogDescription>
                  &ldquo;{archiving?.name}&rdquo; leaves every picker. Calls
                  already tagged with it keep their label — a call tag is never
                  deleted, so the history stays readable.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (archiving) archive.mutate(archiving.id);
                    setArchiving(undefined);
                  }}
                >
                  Archive
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
