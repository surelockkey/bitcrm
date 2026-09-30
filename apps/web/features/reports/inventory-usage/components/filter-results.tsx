"use client";

import { useId, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Popover } from "radix-ui";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { ReportFilters } from "../types";

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  key: keyof ReportFilters;
  heading: string;
  options: FilterOption[];
}

/**
 * Workiz's "Filter results": one box, a searchable list grouped by Techs,
 * Locations, Category and Brand, any number of picks from each. The picks sit
 * in the box as chips, each with its own remove button.
 */
export function FilterResults({
  groups,
  value,
  onChange,
}: {
  groups: FilterGroup[];
  value: ReportFilters;
  onChange: (next: ReportFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  const toggle = (key: keyof ReportFilters, v: string) =>
    onChange({
      ...value,
      [key]: value[key].includes(v) ? value[key].filter((x) => x !== v) : [...value[key], v],
    });

  // A pick the catalog doesn't name (yet, or any more) still shows — as "…",
  // never as a raw id.
  const picked = groups.flatMap((g) =>
    value[g.key].map((v) => ({
      key: g.key,
      value: v,
      heading: g.heading,
      label: g.options.find((o) => o.value === v)?.label ?? (g.key === "categories" ? v : "…"),
    })),
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="flex min-h-10 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1 dark:bg-input/30">
          {picked.map((p) => (
            <span
              key={`${p.key}:${p.value}`}
              title={`${p.heading}: ${p.label}`}
              className="inline-flex max-w-[14rem] items-center gap-1 rounded-chip border bg-muted py-0.5 pr-1 pl-2 text-xs"
            >
              <span className="truncate">{p.label}</span>
              <button
                type="button"
                aria-label={`Remove ${p.label}`}
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                onClick={() => toggle(p.key, p.value)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Popover.Trigger asChild>
            <button
              type="button"
              role="combobox"
              aria-label="Filter results"
              aria-expanded={open}
              aria-controls={listId}
              aria-haspopup="listbox"
              className="flex h-8 min-w-[8rem] flex-1 items-center justify-between gap-2 rounded-sm px-1 text-left text-sm text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="truncate">{picked.length ? "Add filter" : "Filter results"}</span>
              <ChevronDown className="size-4 shrink-0 opacity-60" />
            </button>
          </Popover.Trigger>
          {picked.length ? (
            <button
              type="button"
              aria-label="Clear filters"
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
              onClick={() => onChange({ techIds: [], locationIds: [], categories: [], brandIds: [] })}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </Popover.Anchor>

      <Popover.Portal>
        <Popover.Content
          id={listId}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-(--radix-popover-trigger-width) min-w-[16rem] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md"
        >
          <Command loop>
            <CommandInput autoFocus placeholder="Search filters" className="h-9" />
            <CommandList className="max-h-[min(20rem,var(--radix-popover-content-available-height))]">
              <CommandEmpty>Nothing matches.</CommandEmpty>
              {groups.map((g) =>
                g.options.length ? (
                  <CommandGroup key={g.key} heading={g.heading}>
                    {g.options.map((o) => (
                      <CommandItem
                        key={o.value}
                        // Unique per group (an id may repeat across catalogs);
                        // people search by the name and the group.
                        value={`${g.key}:${o.value}`}
                        keywords={[o.label, g.heading]}
                        data-checked={value[g.key].includes(o.value) ? "true" : undefined}
                        onSelect={() => toggle(g.key, o.value)}
                      >
                        <span className="truncate">{o.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ) : null,
              )}
            </CommandList>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
