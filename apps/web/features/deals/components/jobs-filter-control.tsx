"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "radix-ui";
import { ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { tagSolidClasses } from "@/features/job-tags/lib";
import { techColor } from "../tech-color";
import {
  chooseFilter,
  clearFilters,
  filterChips,
  filterGroups,
  removeFilterChip,
  type FilterCatalogs,
  type FilterChip,
  type FilterGroup,
  type FilterGroupId,
  type FilterOption,
} from "../job-filters";
import type { JobsListCaps, JobsListState } from "../query-params";

/**
 * The menu's five columns, Workiz's: TECHS, TAGS, JOB TYPE, then RECURRING
 * JOBS — which we have no use for, so ours sit there (STATUS, COMPANY) —
 * and SERVICE AREAS last. Typing hides the columns with nothing left and the
 * rest close up to the left, as Workiz's do ("tex" → TAGS in column 1).
 */
const COLUMNS: FilterGroupId[][] = [["tech"], ["tag"], ["type"], ["status", "company"], ["area"]];

/** Option text for the groups Workiz draws as plain words; the rest are chips. */
const PLAIN: FilterGroupId[] = ["type", "status", "company"];

/**
 * Workiz's "Filter results" (list_03_filter_open, jobslist_wz_filter_*): a
 * react-select you type straight into, its picks shown inside as chips in
 * their own colours ("user: (2) TX - DAVID SZENDER ×"), a clear-all × and a
 * chevron at the right. Open, one panel under it lays the groups side by
 * side; picking an option closes it, as react-select does.
 *
 * The visit-day window and the hours — ours, Workiz has neither — sit in a
 * strip under the columns, so they are never cut off by the 300px list.
 *
 * The rules live in `job-filters.ts`; this is the drawing and the keys.
 * Measured: control 49px high, border #ccc radius 4, a 1px yellow ring
 * (no border) while focused; placeholder 16px #808080; chips 11.9px/500 white
 * on the option's colour; columns of 32px rows, headings 10.5px/500 #999.
 */
export function JobsFilterControl({
  state,
  onChange,
  catalogs,
  caps,
}: {
  state: JobsListState;
  onChange: (next: JobsListState) => void;
  catalogs: FilterCatalogs;
  caps: JobsListCaps;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const controlRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const chips = filterChips(state, catalogs);
  const groups = useMemo(() => filterGroups(catalogs, state, query), [catalogs, state, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const tagColor = useMemo(() => new Map(catalogs.tags.map((t) => [t.id, t.color])), [catalogs.tags]);
  const columns = COLUMNS.map((ids) => groups.filter((g) => ids.includes(g.id))).filter((c) => c.length > 0);

  /**
   * The chip / option colour: a tech's own, a tag's own, an area's — Workiz
   * colours its areas, our catalog keeps no colour, so each area gets a
   * steady one of its own. Job types, statuses and companies are words.
   */
  const colour = (kind: string, value: string): string | null => {
    if (kind === "tech" || kind === "area") return techColor(value);
    if (kind === "tag") {
      const c = tagColor.get(value);
      return c ? tagSolidClasses(c) : null;
    }
    return null;
  };

  // Workiz closes the menu on a pick (react-select closeMenuOnSelect) and
  // keeps the caret in the box, ring and all.
  const pick = (o: FilterOption) => {
    onChange(chooseFilter(state, o, caps));
    setQuery("");
    setActive(0);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = flat[active];
      if (open && o) pick(o);
    } else if (e.key === "Backspace" && !query && chips.length) {
      // react-select: an empty input's Backspace takes the last chip off.
      onChange(removeFilterChip(state, chips[chips.length - 1]));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  /** One group: a 16px heading, then its options as 32px rows. */
  const renderGroup = (g: FilterGroup) => (
    <section key={g.id} role="listbox" aria-label={g.title} className="pt-2">
      <h3 className="mb-0.5 h-4 px-3 text-[10.5px] leading-4 font-medium tracking-[0.4px] text-[#999999] uppercase">{g.title}</h3>
      {g.options.map((o) => {
        const i = flat.indexOf(o);
        const c = PLAIN.includes(o.group) ? null : colour(o.group, o.value);
        return (
          <button
            key={`${o.group}:${o.value}`}
            type="button"
            role="option"
            aria-selected={i === active}
            aria-label={o.label}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(o)}
            // A block, not a flex box: the chip inside stays inline, so its
            // colour covers the font's whole box (22px), as Workiz's span does.
            className={cn("block h-8 w-full truncate px-3 text-left leading-8", i === active && "bg-[#deebff]")}
          >
            {c ? (
              <span className={cn("rounded-[3px] px-1 py-px text-sm leading-4 font-medium text-white", c)}>{o.label}</span>
            ) : (
              o.label
            )}
          </button>
        );
      })}
    </section>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div
          ref={controlRef}
          data-slot="jobs-filter-control"
          onMouseDown={(e) => {
            // The whole box is the select: a click anywhere opens it and
            // keeps the caret in the input.
            if (e.target !== inputRef.current) {
              e.preventDefault();
              inputRef.current?.focus();
            }
            setOpen(true);
          }}
          className={cn(
            // list_01: 1210×49, 1px #cccccc, radius 4, white. Focused (open,
            // or after a pick + Escape) the border goes and a 1px yellow
            // ring takes its place — one pixel, not two.
            "flex min-h-[49px] min-w-0 flex-1 cursor-default items-center rounded-[4px] border border-input bg-background",
            "focus-within:border-transparent focus-within:shadow-[0_0_0_1px_#ffd400]",
            open && "border-transparent shadow-[0_0_0_1px_#ffd400]",
          )}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 px-2.5 py-1">
            {chips.map((c) => (
              <Chip
                key={c.key}
                chip={c}
                colour={colour(c.kind, c.value)}
                onRemove={() => onChange(removeFilterChip(state, c))}
              />
            ))}
            <div className="relative min-w-[2px] flex-1">
              {!chips.length && !query ? (
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-base text-[#808080]">
                  Filter results
                </span>
              ) : null}
              <input
                ref={inputRef}
                aria-label="Filter results"
                role="combobox"
                aria-expanded={open}
                aria-controls={menuId}
                aria-autocomplete="list"
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKey}
                className="h-[39px] w-full min-w-[2px] bg-transparent text-sm text-[#333333] outline-none"
              />
            </div>
          </div>
          {chips.length ? (
            <button
              type="button"
              aria-label="Clear filters"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onChange(clearFilters(state))}
              className="grid size-9 place-items-center text-[#666666] hover:text-[#333333]"
            >
              <X className="size-3.5" strokeWidth={3} />
            </button>
          ) : null}
          <span aria-hidden className="h-[30px] w-px self-center bg-input" />
          <span aria-hidden className="grid size-9 place-items-center text-[#999999]">
            <ChevronDown className="size-5" />
          </span>
        </div>
      </Popover.Anchor>

      <Popover.Portal>
        <Popover.Content
          id={menuId}
          align="start"
          side="bottom"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // A press on the control itself is not "outside" — it is how the
            // menu is driven.
            if (controlRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          style={{ width: "var(--radix-popper-anchor-width)" }}
          className="z-50 rounded-[4px] bg-popover text-sm text-[#404040] shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_4px_11px_rgba(0,0,0,0.1)]"
        >
          {/* Workiz's 300px list: five 242px columns, the whole list scrolling. */}
          <div className="max-h-[300px] overflow-auto py-1">
            <div className="grid grid-cols-5">
              {columns.map((col) => (
                <div key={col[0].id} className="min-w-0">
                  {col.map(renderGroup)}
                </div>
              ))}
            </div>
          </div>
          {!query.trim() ? <ScheduledStrip state={state} onChange={onChange} /> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * One picked value: Workiz's chip — a 26px white frame (1px #ccc, radius 2)
 * round a 24px block in the option's colour (radius 3, 4px sides), the label
 * (6px in) and its own × segment behind a #ccc rule (jobslist_wz_filter_three).
 */
function Chip({ chip, colour, onRemove }: { chip: FilterChip; colour: string | null; onRemove: () => void }) {
  return (
    <span
      className="inline-flex h-[26px] max-w-[22rem] items-stretch rounded-chip border border-input bg-background"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span
        className={cn(
          "flex min-w-0 items-stretch overflow-hidden rounded-[3px] pl-1",
          colour ?? "bg-[#e6e6e6] text-[#333333]",
          colour && "text-white",
        )}
      >
        <span className="truncate py-[3px] pr-[3px] pl-1.5 text-[11.9px] leading-4 font-medium">{chip.label}</span>
        <button
          type="button"
          aria-label={`Remove ${chip.label}`}
          onClick={onRemove}
          className="grid w-[23px] shrink-0 place-items-center border-l border-input hover:brightness-90"
        >
          <X className="size-2.5" strokeWidth={3.5} />
        </button>
      </span>
    </span>
  );
}

/**
 * Ours, under Workiz's columns: the visit-day window and the hours, one
 * labelled row, always in full view. Native inputs, so the panel never opens
 * a second popover over itself.
 */
function ScheduledStrip({ state, onChange }: { state: JobsListState; onChange: (next: JobsListState) => void }) {
  const today = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, []);
  const field =
    "h-8 rounded-[4px] border border-[#9ea6aa] bg-background px-2 text-[13px] text-foreground outline-none focus:border-[#6aa8ee] disabled:opacity-50";
  const heading = "text-[10.5px] leading-4 font-medium tracking-[0.4px] text-[#999999] uppercase";
  return (
    <section aria-label="Scheduled" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-3 py-2.5">
      <h3 className={heading}>Scheduled</h3>
      <input
        type="date"
        aria-label="From day"
        className={cn(field, "w-[150px]")}
        value={state.dateFrom ?? ""}
        onChange={(e) => {
          const from = e.target.value || undefined;
          const to = state.dateTo && from && state.dateTo < from ? undefined : state.dateTo;
          onChange({ ...state, dateFrom: from, dateTo: from ? to : undefined });
        }}
      />
      <span className="text-[#999999]">–</span>
      <input
        type="date"
        aria-label="To day"
        className={cn(field, "w-[150px]")}
        min={state.dateFrom}
        disabled={!state.dateFrom}
        value={state.dateTo ?? ""}
        onChange={(e) => onChange({ ...state, dateTo: e.target.value || undefined })}
      />
      <button
        type="button"
        onClick={() => onChange({ ...state, dateFrom: today, dateTo: today })}
        className="text-[13px] font-medium text-[#6aa8ee] hover:underline"
      >
        Today
      </button>
      <h3 className={cn(heading, "ml-6")}>Hours</h3>
      <input
        type="time"
        aria-label="From hour"
        className={cn(field, "w-[120px]")}
        value={state.hourFrom ?? ""}
        onChange={(e) => onChange({ ...state, hourFrom: e.target.value || undefined })}
      />
      <span className="text-[#999999]">–</span>
      <input
        type="time"
        aria-label="To hour"
        className={cn(field, "w-[120px]")}
        value={state.hourTo ?? ""}
        onChange={(e) => onChange({ ...state, hourTo: e.target.value || undefined })}
      />
    </section>
  );
}
