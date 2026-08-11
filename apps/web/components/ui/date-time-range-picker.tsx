"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  DAY_END,
  DAY_START,
  MONTHS,
  PRESET_LABEL,
  TIME_OPTIONS,
  WEEKDAYS,
  formatRangeLabel,
  formatTime12,
  monthCells,
  parseDateKey,
  parseTimeInput,
  presetRange,
  shiftMonth,
  toDateKey,
  toIsoInstant,
  toLocalParts,
  type DateTimeRange,
  type RangePreset,
} from "@/lib/date-range";
import { cn } from "@/lib/utils";

/** Layout effects warn when a component is prerendered on the server. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const PRESETS: RangePreset[] = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "thisMonth",
];

/**
 * A self-contained date **and time** range picker: two month grids for the
 * days, quarter-hour selects for the time of day on each bound. Emits absolute
 * UTC instants (see `lib/date-range`), so a range means exactly what the user
 * sees in their own timezone. No calendar dependency — hand-rolled, matching
 * the deals scheduler's month grid.
 */
export function DateTimeRangePicker({
  value,
  onChange,
  className,
  label = "Date & time",
}: {
  value: DateTimeRange;
  onChange: (range: DateTimeRange) => void;
  className?: string;
  /** Accessible name for the trigger. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const from = toLocalParts(value.from);
  const to = toLocalParts(value.to);
  const hasRange = !!(from || to);

  const [view, setView] = useState(() => {
    const anchor = from ? parseDateKey(from.date) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });

  // Close on Escape, like every other overlay in the app.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /**
   * Keep the panel on screen. It hangs off the trigger, which sits well into a
   * filter row, so its natural right edge can land past the viewport. Measure
   * once open (and on resize/scroll) and slide it back by however much it
   * overhangs — written straight to `style`, since feeding the measurement
   * through state would re-measure its own correction.
   */
  useIsomorphicLayoutEffect(() => {
    const el = panelRef.current;
    if (!open || !el) return;

    const fit = () => {
      const margin = 8;
      el.style.transform = "";
      const rect = el.getBoundingClientRect();
      let dx = 0;
      if (rect.right > window.innerWidth - margin) {
        dx = window.innerWidth - margin - rect.right;
      }
      if (rect.left + dx < margin) dx = margin - rect.left;
      if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`;
    };

    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
    };
  }, [open]);

  /** Day click: the first opens a range, the second closes it. A day before
   *  the open start restarts the range rather than making it run backwards. */
  const pickDay = (dateKey: string) => {
    if (!from || to || dateKey < from.date) {
      onChange({ from: toIsoInstant(dateKey, from?.time ?? DAY_START) });
      setHovered(null);
      return;
    }
    onChange({ from: value.from, to: toIsoInstant(dateKey, DAY_END) });
    setHovered(null);
  };

  const setTime = (side: "from" | "to", time: string) => {
    const parts = side === "from" ? from : to;
    if (!parts) return;
    onChange({ ...value, [side]: toIsoInstant(parts.date, time) });
  };

  const clear = () => {
    onChange({});
    setHovered(null);
  };

  // While only the start is set, the hovered day previews the end of the range.
  const previewEnd = to?.date ?? (from && hovered && hovered >= from.date ? hovered : null);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border px-3 text-left text-sm hover:border-border/80",
          !hasRange && "text-muted-foreground",
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        <span className="whitespace-nowrap">{formatRangeLabel(value)}</span>
        {hasRange ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date filter"
            onClick={(e) => {
              e.stopPropagation();
              clear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                clear();
              }
            }}
            className="-mr-1 grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close calendar"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            data-slot="date-range-panel"
            className="absolute left-0 top-full z-20 mt-1 w-max max-w-[calc(100vw-1rem)] max-h-[calc(100vh-7rem)] overflow-auto overscroll-contain rounded-lg border bg-popover p-3 shadow-md"
          >
            <div className="flex gap-3">
              {/* Presets */}
              <div className="flex w-24 shrink-0 flex-col gap-0.5 border-r pr-3 sm:w-32">
                {PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      const next = presetRange(preset);
                      onChange(next);
                      const anchor = parseDateKey(toLocalParts(next.from)!.date);
                      setView(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
                    }}
                    className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    {PRESET_LABEL[preset]}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  All time
                </button>
              </div>

              {/* Calendars */}
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setView(shiftMonth(view, -1))}
                    aria-label="Previous month"
                    className="grid size-7 place-items-center rounded-md hover:bg-muted"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <div className="flex flex-1 justify-around text-sm font-medium">
                    <span>
                      {MONTHS[view.getMonth()]} {view.getFullYear()}
                    </span>
                    {/* The second month only appears where it fits — below
                        `md` the panel would be wider than the viewport. */}
                    <span className="hidden md:inline">
                      {MONTHS[shiftMonth(view, 1).getMonth()]}{" "}
                      {shiftMonth(view, 1).getFullYear()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setView(shiftMonth(view, 1))}
                    aria-label="Next month"
                    className="grid size-7 place-items-center rounded-md hover:bg-muted"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>

                <div className="flex gap-4" onMouseLeave={() => setHovered(null)}>
                  <MonthGrid
                    view={view}
                    fromDate={from?.date}
                    toDate={previewEnd}
                    onPick={pickDay}
                    onHover={setHovered}
                  />
                  <MonthGrid
                    className="hidden md:block"
                    view={shiftMonth(view, 1)}
                    fromDate={from?.date}
                    toDate={previewEnd}
                    onPick={pickDay}
                    onHover={setHovered}
                  />
                </div>

                {/* Time of day on each bound */}
                <div className="mt-3 grid gap-3 border-t pt-3 md:grid-cols-2">
                  <TimeField
                    label="Start time"
                    value={from?.time}
                    disabled={!from}
                    onChange={(t) => setTime("from", t)}
                  />
                  <TimeField
                    label="End time"
                    value={to?.time}
                    disabled={!to}
                    onChange={(t) => setTime("to", t)}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {from && !to
                    ? "Pick the end day to close the range."
                    : "Click a day to start a new range."}
                </p>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * A time box you can either type into or pick from. Typing is the point —
 * `9`, `9:07`, `930`, `9:30 pm` all parse (see `parseTimeInput`), so any
 * minute is reachable; the quarter-hour list underneath is the shortcut.
 * The draft is committed on Enter, on blur, or by picking a suggestion, and
 * abandoned on Escape — the field never holds an unparseable value.
 */
function TimeField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value?: string;
  disabled?: boolean;
  onChange: (time: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);

  // No mirrored state: while nobody is typing, the box shows the range's time.
  const text = draft ?? (value ? formatTime12(value) : "");
  const parsed = draft === null ? value : parseTimeInput(draft);
  const invalid = draft !== null && draft.trim() !== "" && !parsed;

  const query = (draft ?? "").trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!query) return TIME_OPTIONS;
    const hit = (t: string) =>
      t.startsWith(query) || formatTime12(t).toLowerCase().startsWith(query);
    const matches = TIME_OPTIONS.filter(hit);
    return matches.length ? matches : TIME_OPTIONS;
  }, [query]);

  // Keep the highlighted suggestion in view while arrowing through the list.
  useEffect(() => {
    if (!listOpen || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [listOpen, active]);

  const close = () => {
    setListOpen(false);
    setActive(-1);
  };

  const commit = (time?: string) => {
    if (time) onChange(time);
    setDraft(null);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setListOpen(true);
      setActive((i) => {
        const step = e.key === "ArrowDown" ? 1 : -1;
        const next = i + step;
        if (next < 0) return suggestions.length - 1;
        return next >= suggestions.length ? 0 : next;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit(active >= 0 ? suggestions[active] : (parsed ?? undefined));
      return;
    }
    if (e.key === "Escape" && (listOpen || draft !== null)) {
      // Abandon the edit without closing the whole calendar.
      e.stopPropagation();
      setDraft(null);
      close();
    }
  };

  const id = `time-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const listId = `${id}-list`;

  return (
    <div className="relative space-y-1">
      <label
        className="block text-xs font-medium text-muted-foreground"
        htmlFor={id}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listId}
        aria-activedescendant={
          listOpen && active >= 0 ? `${listId}-${active}` : undefined
        }
        aria-autocomplete="list"
        autoComplete="off"
        inputMode="numeric"
        placeholder="e.g. 9:30 AM"
        disabled={disabled}
        value={text}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setListOpen(true);
          setActive(-1);
        }}
        onFocus={() => setListOpen(true)}
        // Committing on blur keeps a typed time from being silently dropped;
        // anything unparseable falls back to the value already in the range.
        onBlur={() => commit(parsed ?? undefined)}
        onKeyDown={onKeyDown}
        className={cn(
          "h-8 w-full rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          invalid && "border-destructive focus-visible:ring-destructive/40",
        )}
      />
      {listOpen && !disabled ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute bottom-full left-0 z-30 mb-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
        >
          {suggestions.map((t, i) => (
            <li key={t}>
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={t === value}
                // mousedown, not click: blur would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(t);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "w-full px-2 py-1 text-left text-sm",
                  i === active ? "bg-muted" : "hover:bg-muted",
                  t === value && "font-medium text-brand",
                )}
              >
                {formatTime12(t)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MonthGrid({
  view,
  fromDate,
  toDate,
  onPick,
  onHover,
  className,
}: {
  view: Date;
  fromDate?: string;
  toDate?: string | null;
  onPick: (dateKey: string) => void;
  onHover: (dateKey: string | null) => void;
  className?: string;
}) {
  const cells = useMemo(() => monthCells(view), [view]);
  const today = toDateKey(new Date());

  return (
    <div className={className}>
      <div className="grid grid-cols-7">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="py-1 text-center text-[10px] font-semibold uppercase text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const key = toDateKey(d);
          const isStart = key === fromDate;
          const isEnd = !!toDate && key === toDate;
          const inRange =
            !!fromDate && !!toDate && key > fromDate && key < toDate;
          // Ends cap the band; the days between it stay square so the
          // highlight reads as one continuous stretch.
          const corners =
            isStart && isEnd
              ? "rounded-md"
              : isStart
                ? toDate
                  ? "rounded-l-md"
                  : "rounded-md"
                : isEnd
                  ? "rounded-r-md"
                  : inRange
                    ? "rounded-none"
                    : "rounded-md";

          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              onMouseEnter={() => onHover(key)}
              aria-pressed={isStart || isEnd}
              className={cn(
                "grid size-8 place-items-center text-sm tabular-nums transition-colors",
                corners,
                inRange && "bg-brand/10",
                isStart || isEnd
                  ? "bg-brand font-semibold text-brand-foreground"
                  : !inRange && "hover:bg-muted",
                !isStart &&
                  !isEnd &&
                  key === today &&
                  "font-semibold text-brand ring-1 ring-brand/40",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
