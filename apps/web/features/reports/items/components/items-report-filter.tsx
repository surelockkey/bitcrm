"use client";

import { useMemo, useState } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { ItemsReportFilters } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { toggleItemsFilter } from "../lib";

export interface ItemsFilterOption {
  value: string;
  label: string;
}

export interface ItemsFilterGroup {
  key: keyof ItemsReportFilters;
  label: string;
  options: ItemsFilterOption[];
}

/**
 * Workiz's "Filter results" on this report: one box holding the picked
 * values as chips; open, the four groups side by side — Item type, Job type,
 * Category, Sold by. A group matches any of its values; every group with a
 * value narrows the report.
 */
export function ItemsReportFilter({
  groups,
  filters,
  onChange,
}: {
  groups: ItemsFilterGroup[];
  filters: ItemsReportFilters;
  onChange: (next: ItemsReportFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) for (const o of g.options) m.set(`${g.key}|${o.value}`, o.label);
    return m;
  }, [groups]);

  const picked = groups.flatMap((g) =>
    (filters[g.key] ?? []).map((value) => ({ group: g, value, label: labelOf.get(`${g.key}|${value}`) ?? value })),
  );

  const needle = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, options: needle ? g.options.filter((o) => o.label.toLowerCase().includes(needle)) : g.options }))
    .filter((g) => !needle || g.options.length > 0);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="flex min-h-10 w-full flex-wrap items-center gap-1 rounded-md border bg-background py-1 pr-1 pl-2 focus-within:ring-2 focus-within:ring-ring/40">
          {picked.map(({ group, value, label }) => (
            <span
              key={`${group.key}|${value}`}
              title={group.label}
              className="inline-flex max-w-[16rem] items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-xs"
            >
              <span className="truncate">{label}</span>
              <button
                type="button"
                aria-label={`Remove ${group.label}: ${label}`}
                className="rounded-sm opacity-70 hover:opacity-100"
                onClick={() => onChange(toggleItemsFilter(filters, group.key, value))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Popover.Trigger asChild>
            <button
              type="button"
              aria-label="Filter results"
              className="flex h-8 min-w-[6rem] flex-1 items-center justify-between gap-2 rounded-sm px-1 text-left text-sm text-muted-foreground"
            >
              <span>{picked.length === 0 ? "Filter results" : ""}</span>
              <ChevronDown aria-hidden className="size-4 shrink-0" />
            </button>
          </Popover.Trigger>
          {picked.length > 0 ? (
            <button
              type="button"
              aria-label="Clear filters"
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
              onClick={() => onChange({})}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </Popover.Anchor>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[min(96vw,var(--radix-popover-trigger-width,56rem))] max-w-[96vw] rounded-md border bg-popover p-0 text-popover-foreground shadow-md"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              aria-label="Search filters"
              placeholder="Search…"
              className="h-7 flex-1 bg-transparent text-sm outline-none"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex max-h-[22rem] overflow-x-auto" role="group" aria-label="Filter groups">
            {shown.map((g) => (
              <section key={g.key} aria-label={g.label} className="flex min-w-[11rem] flex-1 flex-col border-r last:border-r-0">
                <h3 className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.label}</h3>
                <div className="flex-1 overflow-y-auto pb-2">
                  {g.options.length === 0 ? (
                    <p className="px-3 py-1 text-xs text-muted-foreground">—</p>
                  ) : (
                    g.options.map((o) => {
                      const on = (filters[g.key] ?? []).includes(o.value);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => onChange(toggleItemsFilter(filters, g.key, o.value))}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-accent",
                            on && "bg-accent/60 font-medium",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{o.label}</span>
                          {on ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </section>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
