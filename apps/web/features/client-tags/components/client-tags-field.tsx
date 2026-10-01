"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useSetContactTags } from "@/features/clients/hooks";
import { useClientTags, useCreateClientTag } from "../hooks";
import { activeClientTags, clientTagMap, tagColorClasses } from "../lib";

/**
 * Workiz's tags on the client card: a chip per tag with an × to take it off,
 * and "+ Add tag" — a popup that searches the catalog, attaches an existing
 * tag, or creates the typed name on the spot and attaches that.
 */
export function ClientTagsField({
  contactId,
  tagIds,
  canEdit,
  canCreate,
  className,
}: {
  contactId: string;
  tagIds: string[] | undefined;
  /** `contacts.edit`: may put tags on and take them off. */
  canEdit: boolean;
  /** `client_tags.create`: may make a new tag from the popup. */
  canCreate: boolean;
  className?: string;
}) {
  const ids = useMemo(() => tagIds ?? [], [tagIds]);
  const { data: catalog, isLoading } = useClientTags();
  const map = clientTagMap(catalog);
  const setTags = useSetContactTags(contactId);
  const create = useCreateClientTag();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const remove = (id: string) => setTags.mutate(ids.filter((x) => x !== id));
  const attach = (id: string) => {
    setOpen(false);
    setQuery("");
    if (!ids.includes(id)) setTags.mutate([...ids, id]);
  };
  const createAndAttach = (name: string) =>
    create.mutate({ name, color: "slate" }, { onSuccess: (tag) => attach(tag.id) });

  const candidates = activeClientTags(catalog).filter((t) => !ids.includes(t.id));
  const typed = query.trim();
  const nameTaken = (catalog ?? []).some((t) => t.name.trim().toLowerCase() === typed.toLowerCase());
  const offerCreate = canCreate && typed.length > 0 && !nameTaken;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {ids.map((id) => {
        const tag = map.get(id);
        if (!tag && isLoading) return <span key={id} className="inline-block h-5 w-14 animate-pulse rounded-chip bg-muted" />;
        return (
          <span
            key={id}
            className={cn(
              "inline-flex h-6 max-w-48 items-center gap-1 rounded-chip border pl-2 text-[11px] font-semibold uppercase tracking-wide",
              canEdit ? "pr-1" : "pr-2",
              tag ? tagColorClasses(tag.color) : "border-border bg-muted/60 text-muted-foreground",
            )}
            title={tag?.name ?? id}
          >
            <span className="truncate">{tag?.name ?? id}</span>
            {canEdit ? (
              <button
                type="button"
                aria-label={`Remove ${tag?.name ?? id}`}
                onClick={() => remove(id)}
                disabled={setTags.isPending}
                className="rounded-full p-0.5 hover:bg-foreground/10"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        );
      })}

      {canEdit ? (
        <Popover.Root
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setQuery("");
          }}
        >
          <Popover.Trigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs text-brand" aria-label="Add tag">
              <Plus className="size-3.5" /> Add tag
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="start" sideOffset={4} className="z-50 w-64 rounded-xl border bg-popover p-0 text-popover-foreground shadow-md">
              <Command loop shouldFilter>
                <CommandInput autoFocus placeholder="Search or create a tag…" className="h-9" value={query} onValueChange={setQuery} />
                <CommandList className="max-h-64">
                  <CommandEmpty>{offerCreate ? "No such tag yet." : "Nothing matches."}</CommandEmpty>
                  {candidates.length ? (
                    <CommandGroup heading="Tags">
                      {candidates.map((t) => (
                        <CommandItem key={t.id} value={t.name} onSelect={() => attach(t.id)}>
                          <span className={cn("inline-flex items-center rounded-chip border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", tagColorClasses(t.color))}>
                            {t.name}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}
                  {offerCreate ? (
                    <CommandGroup forceMount>
                      <CommandItem value={`__create__ ${typed}`} forceMount onSelect={() => createAndAttach(typed)} disabled={create.isPending}>
                        <Plus className="size-3.5" /> Create &quot;{typed}&quot;
                      </CommandItem>
                    </CommandGroup>
                  ) : null}
                </CommandList>
              </Command>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </div>
  );
}
