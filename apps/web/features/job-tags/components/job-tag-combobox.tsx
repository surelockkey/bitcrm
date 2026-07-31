"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useJobTags } from "../hooks";
import { activeJobTags, jobTagMap, tagColorClasses } from "../lib";

/**
 * Job-tag picker: selected tags show as removable colored chips; pressing
 * "Add tag" opens a searchable dropdown to pick more. The full catalog isn't
 * shown until you ask for it.
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
  const { data, isLoading } = useJobTags();
  const active = activeJobTags(data);
  const map = jobTagMap(data);
  const [open, setOpen] = useState(false);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const tag = map.get(id);
        // Until the tag catalog loads, show a skeleton rather than the raw id —
        // otherwise chips flash ids on a fresh page load.
        if (!tag && isLoading) {
          return <span key={id} className="inline-block h-5 w-16 animate-pulse rounded-full bg-muted" />;
        }
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
              <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border bg-popover shadow-md">
                <Command loop>
                  <CommandInput autoFocus placeholder="Search tags…" className="h-9" />
                  <CommandList className="max-h-56">
                    <CommandEmpty>No tags found.</CommandEmpty>
                    <CommandGroup>
                      {active.map((tag) => {
                        const checked = value.includes(tag.id);
                        return (
                          <CommandItem key={tag.id} value={tag.name} onSelect={() => toggle(tag.id)} className="gap-2">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                                tagColorClasses(tag.color),
                              )}
                            >
                              {tag.name}
                            </span>
                            {checked ? <Check className="ml-auto size-4 text-brand" /> : null}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
