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

/** The groups Workiz itself has, each a column of its own. */
const WORKIZ_COLUMNS: FilterGroupId[] = ["tech", "tag", "type", "area"];
import type { JobsListCaps, JobsListState } from "../query-params";

/**
 * Workiz's "Filter results" (list_03_filter_open, jobslist_wz_filter_*): a
 * react-select you type straight into, its picks shown inside as chips in
 * their own colours ("user: (2) TX - DAVID SZENDER ×"), a clear-all × and a
 * chevron at the right. Open, one panel under it lays the groups side by
 * side — TECHS, TAGS, JOB TYPE, SERVICE AREAS — and ours after them: STATUS
 * (Done / Canceled, which are not tabs), COMPANY, SORT and SCHEDULED.
 *
 * The rules live in `job-filters.ts`; this is the drawing and the keys.
 * Measured: control 49px high, border #ccc radius 4, yellow 1px ring when
 * open; placeholder 16px #808080; chips 11.9px/500 white on the option's
 * colour; panel 300px, columns of 32px rows, headings 10.5px/500 #999.
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

  /** The chip / option colour: a tech's own, a tag's own; everything else is plain. */
  const colour = (kind: string, value: string): string | null => {
    if (kind === "tech") return techColor(value);
    if (kind === "tag") {
      const c = tagColor.get(value);
      return c ? tagSolidClasses(c) : null;
    }
    return null;
  };

  const pick = (o: FilterOption) => {
    onChange(chooseFilter(state, o, caps));
    setQuery("");
    setActive(0);
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

  const scheduledOnly = !query.trim();

  /** One group: its heading, then its options as 32px rows (chips for techs and tags). */
  const renderGroup = (g: FilterGroup) => (
    <section key={g.id} role="listbox" aria-label={g.title}>
      <h3 className="px-3 py-1 text-[10.5px] leading-4 font-medium tracking-[0.4px] text-[#999999] uppercase">{g.title}</h3>
      {g.options.map((o) => {
        const i = flat.indexOf(o);
        const c = colour(o.group, o.value);
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
            className={cn("flex h-8 w-full items-center px-3 text-left", i === active && "bg-[#deebff]")}
          >
            {c ? (
              <span className={cn("max-w-full truncate rounded-[3px] px-1 py-px text-sm leading-4 font-medium text-white", c)}>
                {o.label}
              </span>
            ) : (
              <span className="truncate">{o.label}</span>
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
            // list_01: 1210×49, 1px #cccccc, radius 4, white.
            "flex min-h-[49px] min-w-0 flex-1 cursor-default items-center rounded-[4px] border border-input bg-background",
            open && "border-[#ffd400] shadow-[0_0_0_1px_#ffd400]",
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
              className="grid size-9 place-items-center text-[#999999] hover:text-[#333333]"
            >
              <X className="size-4" />
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
          className="z-50 max-h-[300px] overflow-auto rounded-[4px] bg-popover text-sm text-[#404040] shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_4px_11px_rgba(0,0,0,0.1)]"
        >
          {/* Workiz's grid: five 242px columns across the 1210px panel. Its
              first four are ours too; its fifth (RECURRING JOBS — we have no
              recurring jobs) holds ours instead, one under another. */}
          <div className="grid grid-cols-5 py-1">
            {groups
              .filter((g) => WORKIZ_COLUMNS.includes(g.id))
              .map((g) => (
                <div key={g.id} className="min-w-0">
                  {renderGroup(g)}
                </div>
              ))}
            <div className="min-w-0">
              {groups.filter((g) => !WORKIZ_COLUMNS.includes(g.id)).map(renderGroup)}
              {scheduledOnly ? <ScheduledColumn state={state} onChange={onChange} /> : null}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** One picked value: Workiz's two-part chip — the label, then its own × segment. */
function Chip({ chip, colour, onRemove }: { chip: FilterChip; colour: string | null; onRemove: () => void }) {
  return (
    <span
      className={cn(
        // list jobslist_wz_filter_three: a 26px white frame (1px #ccc, radius 2)
        // around a 24px block in the option's colour (radius 3).
        "inline-flex h-[26px] max-w-[22rem] items-stretch rounded-chip border border-input bg-background p-px",
      )}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span
        className={cn(
          "flex min-w-0 items-stretch overflow-hidden rounded-[3px]",
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
          <X className="size-3.5" strokeWidth={2.5} />
        </button>
      </span>
    </span>
  );
}

/**
 * Ours, after Workiz's columns: the visit-day window and the hours. Native
 * inputs, so the panel never opens a second popover over itself.
 */
function ScheduledColumn({ state, onChange }: { state: JobsListState; onChange: (next: JobsListState) => void }) {
  const today = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, []);
  const field = "h-8 w-full rounded-[4px] border border-[#9ea6aa] bg-background px-2 text-[13px] text-foreground outline-none focus:border-[#6aa8ee]";
  return (
    <section aria-label="Scheduled" className="px-3 pb-2">
      <h3 className="pt-2 pb-1 text-[10.5px] leading-4 font-medium tracking-[0.4px] text-[#999999] uppercase">Scheduled</h3>
      <div className="space-y-2 py-1">
        <div className="grid grid-cols-1 gap-2">
          <input
            type="date"
            aria-label="From day"
            className={field}
            value={state.dateFrom ?? ""}
            onChange={(e) => {
              const from = e.target.value || undefined;
              const to = state.dateTo && from && state.dateTo < from ? undefined : state.dateTo;
              onChange({ ...state, dateFrom: from, dateTo: from ? to : undefined });
            }}
          />
          <input
            type="date"
            aria-label="To day"
            className={field}
            min={state.dateFrom}
            disabled={!state.dateFrom}
            value={state.dateTo ?? ""}
            onChange={(e) => onChange({ ...state, dateTo: e.target.value || undefined })}
          />
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...state, dateFrom: today, dateTo: today })}
          className="text-[13px] font-medium text-[#6aa8ee] hover:underline"
        >
          Today
        </button>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="time"
            aria-label="From hour"
            className={field}
            value={state.hourFrom ?? ""}
            onChange={(e) => onChange({ ...state, hourFrom: e.target.value || undefined })}
          />
          <input
            type="time"
            aria-label="To hour"
            className={field}
            value={state.hourTo ?? ""}
            onChange={(e) => onChange({ ...state, hourTo: e.target.value || undefined })}
          />
        </div>
      </div>
    </section>
  );
}
