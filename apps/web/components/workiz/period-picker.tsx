"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The legacy reports' period picker (`.date_picker_gen`, Job Statistics:
 * rep_jobstats_wz_02_overview_day, _07_period_open / _hover / _custom /
 * _custom_cal, _15_empty_sources).
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const parts = (day: string) =>
  day.split("-").map(Number) as [number, number, number];
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** "Oct 01 , 2026" — the legacy picker's own spacing. */
const dayText = (day: string): string => {
  const [y, m, d] = parts(day);
  return `${MONTHS[m - 1]} ${pad(d)} , ${y}`;
};

/** The days under the period's name: "Oct 01 , 2026 - Oct 08 , 2026", one day alone. */
export function wzRangeText(from: string, to: string): string {
  return from === to ? dayText(from) : `${dayText(from)} - ${dayText(to)}`;
}

/** "10/03/2026", as Custom's inputs show a picked day. */
const usDay = (day: string): string => {
  const [y, m, d] = parts(day);
  return `${pad(m)}/${pad(d)}/${y}`;
};

export interface WzPeriodPickerProps<P extends string> {
  /** Workiz's list in its order; the id "custom" opens From / To. */
  presets: readonly { id: P; label: string }[];
  preset: P;
  /** The days on show (YYYY-MM-DD, both included). */
  range: { from: string; to: string };
  onPresetChange: (preset: P) => void;
  /** Custom's two days, once both are picked (From ≤ To). */
  onCustomChange: (days: { from: string; to: string }) => void;
  /** The account's today, for the calendar's first month. */
  today: string;
  className?: string;
}

/**
 * A 262px box (1px #ddd): the period's name (12px) over its days (14px/700)
 * with a thin chevron after them. A click hangs the periods under it — 35px
 * rows of 14px #404040 between #ddd rules, #e1e1e1 under the mouse. Custom
 * grows the box by a From / To row: 100×30 inputs (#f7f7f7, 1px #ccc,
 * radius 2, #ffd400 when focused) "to:" between them, each opening the Glow
 * calendar Workiz uses (`gldp-default`).
 */
export function WzPeriodPicker<P extends string>({
  presets,
  preset,
  range,
  onPresetChange,
  onCustomChange,
  today,
  className,
}: WzPeriodPickerProps<P>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<"from" | "to" | null>(null);
  const [draft, setDraft] = useState<{ from?: string; to?: string }>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const custom = preset === ("custom" as P);
  const label = presets.find((p) => p.id === preset)?.label ?? "";

  useEffect(() => {
    if (!open && !field) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setField(null);
      }
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      setField(null);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, field]);

  const pickPreset = (p: P) => {
    setOpen(false);
    if (p === ("custom" as P)) setDraft({});
    onPresetChange(p);
    buttonRef.current?.focus();
  };

  const pickDay = (day: string) => {
    const next = { ...draft, [field!]: day };
    setDraft(next);
    setField(null);
    if (next.from && next.to) {
      onCustomChange(
        next.from <= next.to
          ? { from: next.from, to: next.to }
          : { from: next.to, to: next.from },
      );
    }
  };

  const menuId = `${id}-menu`;

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative w-[262px] border border-wz-frame text-sm leading-4 tracking-[0.4px] text-wz-strong",
        className,
      )}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Date range: ${label}, ${wzRangeText(range.from, range.to)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-end gap-[7px] p-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-wz-focus focus-visible:ring-inset"
      >
        <span className="block">
          <span className="block text-xs leading-4">{label}</span>
          <span className="block p-0.5 text-sm leading-4 font-bold whitespace-nowrap">
            {wzRangeText(range.from, range.to)}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className="mb-[3px] size-5 shrink-0"
          strokeWidth={1}
        />
      </button>

      {custom ? (
        <div className="flex items-center gap-0.5 border-t border-wz-frame px-2.5 pt-[9px] pb-[11px] text-wz-text">
          <DayInput
            label="From"
            placeholder="from"
            value={draft.from}
            active={field === "from"}
            onOpen={() => setField(field === "from" ? null : "from")}
          />
          <span className="px-0.5">to:</span>
          <DayInput
            label="To"
            placeholder="to"
            value={draft.to}
            active={field === "to"}
            onOpen={() => setField(field === "to" ? null : "to")}
          />
        </div>
      ) : null}

      {field ? (
        <LegacyCalendar
          className={cn(
            "absolute top-[97px] z-50",
            field === "from" ? "left-3" : "left-[138px]",
          )}
          value={draft[field]}
          start={
            draft[field] ??
            (field === "to" ? draft.from : undefined) ??
            range.from ??
            today
          }
          today={today}
          onPick={pickDay}
        />
      ) : null}

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Date range"
          className="absolute top-[54px] -left-px z-50 w-[262px] border-x border-b border-wz-frame bg-background pb-2.5"
        >
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              onClick={() => pickPreset(p.id)}
              className="block w-full cursor-pointer border-b border-wz-frame py-[9px] pr-[25px] pl-[15px] text-left text-sm leading-4 text-wz-strong outline-none hover:bg-[#e1e1e1] focus-visible:bg-[#e1e1e1]"
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DayInput({
  label,
  placeholder,
  value,
  active,
  onOpen,
}: {
  label: string;
  placeholder: string;
  value?: string;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <input
      type="text"
      readOnly
      aria-label={label}
      placeholder={placeholder}
      value={value ? usDay(value) : ""}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "m-0.5 h-[30px] w-[100px] cursor-pointer rounded-[2px] border bg-muted p-1 text-sm leading-5 text-wz-text outline-none placeholder:text-wz-placeholder",
        active ? "border-wz-focus" : "border-input",
      )}
    />
  );
}

/**
 * The Glow date picker (`gldp-default`, rep_jobstats_wz_07_period_custom_cal):
 * 237×245 on #f0f4f7 with a 0 2px 4px rgba(0,0,0,.45) shadow; a 38px #3c4044
 * bar with ◄ month year ► in white (17px/700); SUN…SAT 9px/700 capitals
 * under a 2px #c7c9ca line; 34×31 days, 12px/700 #6c7174, weekends #666 on
 * white, the neighbour months' days #cfd1d2 on #f2f2f2; the chosen day white
 * on the bar's colour.
 */
function LegacyCalendar({
  value,
  start,
  today,
  onPick,
  className,
}: {
  value?: string;
  start: string;
  today: string;
  onPick: (day: string) => void;
  className?: string;
}) {
  const [y0, m0] = parts(start);
  const [view, setView] = useState({ y: y0, m: m0 });
  const first = new Date(Date.UTC(view.y, view.m - 1, 1));
  const lead = first.getUTCDay();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(Date.UTC(view.y, view.m - 1, 1 - lead + i));
    return {
      key: dayKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
      day: d.getUTCDate(),
      dow: d.getUTCDay(),
      inMonth: d.getUTCMonth() === view.m - 1,
    };
  });
  const step = (n: number) =>
    setView(({ y, m }) => {
      const t = new Date(Date.UTC(y, m - 1 + n, 1));
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
    });
  const chosen = value ?? today;

  return (
    <div
      role="dialog"
      aria-label="Choose a day"
      className={cn(
        "w-[237px] bg-[#f0f4f7] shadow-[0_2px_4px_rgba(0,0,0,0.45)]",
        className,
      )}
    >
      {/* #3c4044: gldp-default-monyear / -prevnext. */}
      <div className="flex h-[38px] items-center bg-[#3c4044] text-white">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => step(-1)}
          className="h-full w-[34px] cursor-pointer text-xs font-bold"
        >
          ◄
        </button>
        <span className="flex-1 text-center text-[17px] leading-[38px] font-bold">
          {MONTH_NAMES[view.m - 1]} {view.y}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => step(1)}
          className="h-full w-[34px] cursor-pointer text-xs font-bold"
        >
          ►
        </button>
      </div>
      <div className="grid grid-cols-7 shadow-[inset_0_2px_0_#c7c9ca]">
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            aria-hidden
            className="h-[22px] pt-px text-center text-[9px] leading-5 font-bold text-wz-text uppercase"
          >
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c, i) => {
          const on = c.inMonth && c.key === chosen;
          const weekend = c.dow === 0 || c.dow === 6;
          const [y, m, d] = parts(c.key);
          return (
            <button
              key={c.key}
              type="button"
              aria-label={`${MONTHS[m - 1]} ${d}, ${y}`}
              aria-pressed={on}
              onClick={() => onPick(c.key)}
              className={cn(
                "h-[31px] cursor-pointer border-t border-[#ced3d6] text-xs leading-[30px] outline-none focus-visible:ring-1 focus-visible:ring-wz-focus focus-visible:ring-inset",
                i % 7 > 0 && "border-l border-l-[#ececec]",
                on
                  ? "bg-[#3c4044] font-bold text-white"
                  : !c.inMonth
                    ? "bg-[#f2f2f2] font-normal text-[#cfd1d2]"
                    : weekend
                      ? "bg-white font-bold text-wz-text hover:bg-[#e1e1e1]"
                      : "font-bold text-[#6c7174] hover:bg-[#e1e1e1]",
              )}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
