"use client";

import { useMemo, useState } from "react";
import { Popover } from "radix-ui";
import { Check, ChevronDown, Search, X } from "lucide-react";
import type { JobTagColor, JobsReportFilters } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { tagSolidClasses } from "@/features/job-tags/lib";
import { toggleFilter } from "../lib";

export interface FilterOption {
  value: string;
  label: string;
  /** A tag's colour — its chip is drawn in it, as in Workiz. */
  color?: JobTagColor;
}

export interface FilterGroup<K extends string = keyof JobsReportFilters> {
  key: K;
  label: string;
  options: FilterOption[];
  /**
   * The options are already the answer to the search box (a group looked up
   * on the server as the user types — the Tips report's clients): they are
   * shown as they are, not narrowed by their label again.
   */
  remote?: boolean;
  /** What an empty group says instead of "—" (e.g. "Type to find a client"). */
  empty?: string;
  /** Told what is typed in the search box — a `remote` group looks its options up with it. */
  onSearch?: (query: string) => void;
}

/**
 * Workiz's "Filter results" MultiFilter: one box holding the picked values as
 * chips; open, it lays every group side by side (Status, Team, Created by,
 * Tags, Job type, Job origin, Source, Service areas, Companies). A group
 * matches any of its values, and every group with a value narrows the report.
 * The Sales report's groups (Status, Team, Job type, Payment status, Source,
 * Service Areas) go through it too — `F` is the report's filter shape.
 */
export function JobsReportFilter<F extends object = JobsReportFilters>({
  groups,
  filters,
  onChange,
}: {
  groups: FilterGroup<Extract<keyof F, string>>[];
  filters: F;
  onChange: (next: F) => void;
}) {
  const valuesOf = (key: string): string[] => ((filters as Record<string, unknown>)[key] ?? []) as string[];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const labelOf = useMemo(() => {
    const m = new Map<string, FilterOption>();
    for (const g of groups) for (const o of g.options) m.set(`${g.key}|${o.value}`, o);
    return m;
  }, [groups]);

  const picked = groups.flatMap((g) =>
    valuesOf(g.key).map((value) => ({
      group: g,
      value,
      option: labelOf.get(`${g.key}|${value}`) ?? { value, label: value },
    })),
  );

  const needle = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, options: needle && !g.remote ? g.options.filter((o) => o.label.toLowerCase().includes(needle)) : g.options }))
    .filter((g) => !needle || g.remote || g.options.length > 0);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="flex min-h-10 w-full flex-wrap items-center gap-1 rounded-md border bg-background py-1 pr-1 pl-2 focus-within:ring-2 focus-within:ring-ring/40">
          {picked.map(({ group, value, option }) => (
            <span
              key={`${group.key}|${value}`}
              title={group.label}
              className={cn(
                "inline-flex max-w-[16rem] items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs",
                option.color ? tagSolidClasses(option.color) : "bg-muted",
              )}
            >
              <span className="truncate">{option.label}</span>
              <button
                type="button"
                aria-label={`Remove ${group.label}: ${option.label}`}
                className="rounded-sm opacity-70 hover:opacity-100"
                onClick={() => onChange(toggleFilter(filters, group.key, value))}
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
              <span>{picked.length === 0 ? "Select…" : ""}</span>
              <ChevronDown aria-hidden className="size-4 shrink-0" />
            </button>
          </Popover.Trigger>
          {picked.length > 0 ? (
            <button
              type="button"
              aria-label="Clear filters"
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
              onClick={() => onChange({} as F)}
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
          className="z-50 w-[min(96vw,var(--radix-popover-trigger-width,64rem))] max-w-[96vw] rounded-md border bg-popover p-0 text-popover-foreground shadow-md"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              aria-label="Search filters"
              placeholder="Search…"
              className="h-7 flex-1 bg-transparent text-sm outline-none"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                for (const g of groups) g.onSearch?.(e.target.value);
              }}
            />
          </div>
          <div className="flex max-h-[22rem] overflow-x-auto" role="group" aria-label="Filter groups">
            {shown.map((g) => (
              <section key={g.key} aria-label={g.label} className="flex min-w-[11rem] max-w-[14rem] flex-1 flex-col border-r last:border-r-0">
                <h3 className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g.label}</h3>
                <div className="flex-1 overflow-y-auto pb-2">
                  {g.options.length === 0 ? (
                    <p className="px-3 py-1 text-xs text-muted-foreground">{g.empty ?? "—"}</p>
                  ) : (
                    g.options.map((o) => {
                      const on = valuesOf(g.key).includes(o.value);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => onChange(toggleFilter(filters, g.key, o.value))}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-accent",
                            on && "bg-accent/60 font-medium",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {o.color ? (
                              <span className={cn("rounded-sm px-1.5 py-0.5 text-xs", tagSolidClasses(o.color))}>{o.label}</span>
                            ) : (
                              o.label
                            )}
                          </span>
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
