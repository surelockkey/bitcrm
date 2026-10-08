"use client";

import { useCallback, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Popover } from "radix-ui";

import { cn } from "@/lib/utils";
import { MONTHS, WzCalendar, isoOf, splitIso } from "./calendar";
import { ComboboxMenu, useCombobox, type WzOption } from "./combobox";
import { MuiCalendarIcon, ThinChevronIcon } from "./icons";
import { WzFieldError } from "./messages";
import { mergeRefs } from "./refs";

/*
 * Workiz's newer outlined fields — Starts / Ends (MUI DatePicker) and the two
 * "At" times (react-select in their FloatingLabel shell) — from
 * FloatingLabel-module (main.css) and new_01_empty / formkit_time_open /
 * formkit_date_open:
 *
 *   box     1px #9ea6aa, 4px corners, white; #3b4b52 hovered, #6aa8ee
 *           focused or open. Date 40px tall, time 42px.
 *   label   a notch in the top edge: 11px ink on white, 4px side padding,
 *           8px in and 8px above. Empty and idle, it rests inside the box at
 *           13px #768287 instead (padding 10.25px 12px) and rises on focus.
 *   value   13px ink, 12px in.
 */

const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

/** "15:30" → "03:30 PM" — zero-padded, as Workiz prints its times. */
export function formatWzTime(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return "";
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, "0")}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** Every slot of the day, `step` minutes apart: 96 for Workiz's 15. */
export function wzTimeSlots(step = 15): WzOption[] {
  const out: WzOption[] = [];
  for (let min = 0; min < 24 * 60; min += step) {
    const value = `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    out.push({ value, label: formatWzTime(value) });
  }
  return out;
}

/** "2026-10-08" → "Oct 08, 2026". */
export function formatWzDate(iso: string | null | undefined): string {
  const p = splitIso(iso);
  if (!p) return "";
  return `${SHORT_MONTHS[p[1]]} ${String(p[2]).padStart(2, "0")}, ${p[0]}`;
}

/** What a person types into a date field → "YYYY-MM-DD", or null. */
export function parseWzDate(text: string): string | null {
  const t = text.trim();
  let y: number, mo: number, d: number;
  let m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) {
    mo = SHORT_MONTHS.findIndex((s) => s.toLowerCase() === m![1].toLowerCase());
    d = Number(m[2]);
    y = Number(m[3]);
  } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) {
    mo = Number(m[1]) - 1;
    d = Number(m[2]);
    y = Number(m[3]);
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) {
    y = Number(m[1]);
    mo = Number(m[2]) - 1;
    d = Number(m[3]);
  } else return null;
  if (mo < 0 || mo > 11) return null;
  const iso = isoOf(y, mo, d);
  return splitIso(iso) ? iso : null;
}

/** The label in the notch (or resting inside while empty and idle). Shared with `WzOutlinedSelect`. */
export function NotchedLabel({
  id,
  htmlFor,
  floated,
  children,
}: {
  id?: string;
  htmlFor: string;
  floated: boolean;
  children: ReactNode;
}) {
  return (
    <label
      id={id}
      htmlFor={htmlFor}
      data-floated={floated ? "true" : "false"}
      className={cn(
        "pointer-events-none absolute z-[1] box-border flex truncate tracking-[0.4px] transition-[font-size,padding,top,left,background] duration-200",
        floated
          ? "-top-2 left-2 bg-white px-1 py-0 text-[11px] leading-[normal] text-foreground"
          : "top-0 left-0 h-full items-center bg-transparent py-[10.25px] pr-0 pl-3 text-[13px] leading-[initial] text-wz-outline-label",
        "group-data-[disabled=true]/wzo:text-wz-outline-disabled",
      )}
    >
      {children}
    </label>
  );
}

/** The outlined box (shared with `WzOutlinedSelect`). */
export const OUTLINE = cn(
  "border border-wz-outline bg-white rounded-[4px] transition-colors",
  "hover:border-foreground",
  "group-data-[focused=true]/wzo:border-wz-link group-data-[open=true]/wzo:border-wz-link",
  "group-data-[disabled=true]/wzo:border-wz-outline-disabled group-data-[disabled=true]/wzo:hover:border-wz-outline-disabled",
);

export interface WzTimeSelectProps {
  /** "At". */
  label: string;
  /** "HH:MM", 24-hour; "" for none. Omit for uncontrolled use. */
  value?: string | null;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  /** Minutes between slots; Workiz uses 15. */
  step?: number;
  /** Replace the slot list (e.g. only business hours). */
  options?: WzOption[];
  error?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

/**
 * The "At" time on Starts / Ends. A list of 15-minute slots that, as on
 * Workiz, leaves the chosen time out and opens scrolled to the next one;
 * type "4:3" to narrow it. Controller-ready (`{...field}`).
 */
export function WzTimeSelect({
  label,
  value,
  defaultValue,
  onChange,
  onBlur,
  name,
  id,
  disabled = false,
  step = 15,
  options,
  error,
  className,
  ref,
}: WzTimeSelectProps) {
  const autoId = useId();
  const inputId = id ?? `wz-${autoId}`;
  const labelId = `${inputId}-label`;
  const errorId = `${inputId}-error`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value !== undefined ? (value ?? "") : inner;
  const set = (next: string) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };
  const [focused, setFocused] = useState(false);
  const slots = options ?? wzTimeSlots(step);
  const isSelected = useCallback((o: WzOption) => o.value === current, [current]);

  const combo = useCombobox({
    id: inputId,
    options: slots,
    isSelected,
    hideSelected: true,
    onPick: (o) => set(o.value),
    disabled,
    onBlur: () => {
      setFocused(false);
      onBlur?.();
    },
    onOpenScroll: (list) => {
      // With the chosen slot left out, the next one takes its index.
      const at = slots.findIndex((s) => s.value === current);
      const row = at >= 0 ? (list.children[at] as HTMLElement | undefined) : undefined;
      list.scrollTop = row ? row.offsetTop : 0;
    },
  });

  const hasValue = current !== "";
  const typing = combo.input !== "";

  return (
    <div
      ref={rootRef}
      data-slot="wz-time"
      data-wz-combobox-root=""
      data-open={combo.open ? "true" : "false"}
      data-focused={focused ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
      className={cn("group/wzo relative min-w-0", className)}
      onMouseDown={(e) => combo.onControlMouseDown(e, rootRef)}
    >
      <ComboboxMenu
        combo={combo}
        labelId={labelId}
        isSelected={isSelected}
        look="time"
        anchor={
          <div data-slot="wz-time-control" className={cn(OUTLINE, "relative h-[42px] w-full text-[13px] leading-4 text-wz-strong")}>
            <span
              aria-hidden
              className="absolute top-1/2 right-[9px] flex -translate-y-1/2 text-foreground group-data-[disabled=true]/wzo:text-wz-outline-disabled"
            >
              <ThinChevronIcon up={combo.open} />
            </span>
          </div>
        }
      />
      <NotchedLabel id={labelId} htmlFor={inputId} floated={hasValue || focused || combo.open}>
        {label}
      </NotchedLabel>
      {hasValue && !typing ? (
        <div className="pointer-events-none absolute top-[13px] right-10 left-3 truncate text-[13px] leading-4 text-foreground group-data-[disabled=true]/wzo:text-wz-outline-disabled">
          {formatWzTime(current)}
        </div>
      ) : null}
      <input
        {...combo.inputProps}
        ref={mergeRefs(combo.inputRef, ref)}
        onFocus={() => setFocused(true)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="absolute top-0 right-10 left-3 h-[42px] min-w-0 bg-transparent p-0 text-[13px] leading-4 text-wz-value outline-none"
      />
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
    </div>
  );
}

export interface WzDateFieldProps {
  /** "Starts" / "Ends". */
  label: string;
  /** "YYYY-MM-DD"; "" for none. Omit for uncontrolled use. */
  value?: string | null;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  /** Earliest day offered ("YYYY-MM-DD") — e.g. Ends never before Starts. */
  min?: string;
  max?: string;
  error?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
}

function spoken(iso: string) {
  const p = splitIso(iso);
  return p ? `${SHORT_MONTHS[p[1]]} ${p[2]}, ${p[0]}` : "";
}

/**
 * Starts / Ends: "Oct 08, 2026" in a notched box with MUI's calendar button
 * at the right, which opens a month calendar. The text can be typed too
 * ("Nov 3, 2026", "11/03/2026"); it is read on blur or Enter and put back if
 * it is not a date. Controller-ready (`{...field}`).
 */
export function WzDateField({
  label,
  value,
  defaultValue,
  onChange,
  onBlur,
  name,
  id,
  disabled = false,
  min,
  max,
  error,
  className,
  ref,
}: WzDateFieldProps) {
  const autoId = useId();
  const inputId = id ?? `wz-${autoId}`;
  const errorId = `${inputId}-error`;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value !== undefined ? (value ?? "") : inner;
  const set = (next: string) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (!text) {
      if (current) set("");
      return;
    }
    const iso = parseWzDate(text);
    if (iso && iso !== current && !(min && iso < min) && !(max && iso > max)) set(iso);
  };

  const hasValue = current !== "" || (draft ?? "") !== "";

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div
          data-slot="wz-date"
          data-focused={focused ? "true" : "false"}
          // No data-open here: with the calendar up, focus has left the text
          // and Workiz's edge goes back to grey (ink under the mouse).
          data-calendar={open ? "open" : "closed"}
          data-disabled={disabled ? "true" : "false"}
          className={cn("group/wzo relative min-w-0", className)}
        >
          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="text"
            autoComplete="off"
            disabled={disabled}
            value={draft ?? formatWzDate(current)}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              commit();
              onBlur?.();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft !== null) {
                e.preventDefault();
                commit();
              }
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              OUTLINE,
              "block h-10 w-full py-[10.5px] pr-10 pl-3 text-[13px] leading-[23px] tracking-[0.15008px] text-foreground outline-none",
              "focus:border-wz-link disabled:cursor-not-allowed disabled:text-wz-outline-disabled",
            )}
          />
          <NotchedLabel htmlFor={inputId} floated={hasValue || focused}>
            {label}
          </NotchedLabel>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={current ? `Choose date, selected date is ${spoken(current)}` : "Choose date"}
              className="absolute top-1 right-0 flex h-8 w-10 items-center justify-center rounded-full text-[rgba(0,0,0,0.54)] transition-colors outline-none hover:bg-[rgba(0,0,0,0.04)] focus-visible:bg-[rgba(0,0,0,0.12)] disabled:text-[rgba(0,0,0,0.26)]"
            >
              <MuiCalendarIcon />
            </button>
          </Popover.Trigger>
          {name ? <input type="hidden" name={name} value={current} /> : null}
          {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={0}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[101] rounded-[4px] bg-white shadow-[0px_5px_5px_-3px_rgba(0,0,0,0.2),0px_8px_10px_1px_rgba(0,0,0,0.14),0px_3px_14px_2px_rgba(0,0,0,0.12)] outline-none"
        >
          <WzCalendar
            value={current}
            min={min}
            max={max}
            autoFocus
            onSelect={(iso) => {
              set(iso);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
