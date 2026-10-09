"use client";

import { useCallback, useId, useMemo, useRef, useState, type ReactNode, type Ref } from "react";

import { cn } from "@/lib/utils";
import { ComboboxMenu, useCombobox, type ComboRow, type WzFilter, type WzOption } from "./combobox";
import { RsChevronIcon, RsCrossIcon } from "./icons";
import { WzFieldError } from "./messages";
import { mergeRefs } from "./refs";

export type { WzFilter, WzOption } from "./combobox";
export { containsFilter } from "./combobox";

/*
 * Geometry, from Workiz's react-select overrides (reactCss.css) and the
 * computed boxes on new_01_empty / job_b_01_details / formkit_country_open:
 *
 *   control   min-height 3.04rem (48.64px), 1px #ccc, 4px corners (0 on the
 *             job page), white. Hover edge #b3b3b3. Focused: the border goes
 *             and a 1px #ffd400 ring is drawn outside, so the contents slide
 *             1px left — Workiz does exactly that.
 *   label     with a value, 12px/16px #8c8c8c at 10px/4px (`span._selectLabel`).
 *   placeholder  the same words at 16px #808080, 11px in, 15.32px down.
 *   value     16px/16px #333 at 11px / 24.32px.
 *             (Every labelled Workiz select is `.fLabel`, whose value box is
 *             30px tall; "Assign A Tech" is not — its 28px box puts both
 *             1px lower: geometry="plain".)
 *   input     14px #333, 23.32px down — the caret sits at the value's start.
 *   indicators  [× clear] | separator (1px #ccc, 8px off each edge) | chevron,
 *             each 36px (8px padding round a 20px react-select glyph): #ccc,
 *             #999 hovered, #666 while focused.
 */

const CONTROL = cn(
  "flex min-h-[3.04rem] w-full items-stretch border border-input bg-white text-[14px] leading-4 text-wz-strong transition-colors duration-100",
  "hover:border-wz-field-hover",
  "group-data-[focused=true]/wzsel:border-0 group-data-[focused=true]/wzsel:shadow-[0_0_0_1px_var(--wz-focus)]",
  "group-data-[disabled=true]/wzsel:border-wz-disabled-border group-data-[disabled=true]/wzsel:bg-wz-disabled",
);

const INDICATOR = cn(
  "flex items-center p-2 text-input transition-colors duration-150 hover:text-wz-caption",
  "group-data-[focused=true]/wzsel:text-wz-text group-data-[focused=true]/wzsel:hover:text-wz-value",
);

const SHIFT_LEFT = "left-[11px] group-data-[focused=true]/wzsel:left-[10px]";

export interface WzSelectBaseProps {
  /** Placeholder while empty; the small label over the value once chosen. */
  label: string;
  options: WzOption[];
  onBlur?: () => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  /** Typing filters the list (default). False makes it pick-only. */
  searchable?: boolean;
  /** Override the "contains" filter, or pass null to filter on the server. */
  filterOption?: WzFilter | null;
  /** The typed text, for server search. */
  onInputChange?: (input: string) => void;
  noOptionsMessage?: string;
  /** Shows "Loading..." in place of "No options". */
  loading?: boolean;
  /** 4px corners on the New Job cards; square on the job page's Details tab. */
  shape?: "rounded" | "square";
  /**
   * "labelled" (default): Workiz's `.fLabel` selects — every one with a
   * floating label. "plain": the bare ones like the job page's
   * "Assign A Tech", whose words sit 1px lower. "bare": no label on screen at
   * all (it stays for screen readers) — the value centred, 16.32px down, as
   * the Call Tracking report's "By Call Flow" (rep_calltracking_wz_01_default).
   */
  geometry?: "labelled" | "plain" | "bare";
  error?: string;
  /** Wrapper classes (width, margins). */
  className?: string;
  /** Custom row content (avatars, two-line rows); keeps the row box. */
  renderOption?: (option: WzOption, state: { focused: boolean; selected: boolean }) => ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export interface WzSelectProps extends WzSelectBaseProps {
  /** The chosen value; "" (or null) for none. Omit for uncontrolled use. */
  value?: string | null;
  defaultValue?: string;
  /** The new value, "" when cleared — `field.onChange` of a Controller as is. */
  onChange?: (value: string) => void;
  /** Show a × that clears the value (the job page's Job source). */
  clearable?: boolean;
  /** Shown for a value that is not among the options (an archived type). */
  valueLabel?: string;
  /** An action row first in the list ("+ Add new"); gets the typed text. */
  createOption?: { label?: string; onCreate: (input: string) => void };
}

function useFocusFlag() {
  const [focused, setFocused] = useState(false);
  return { focused, onFocus: () => setFocused(true), onBlurFlag: () => setFocused(false) };
}

function rowRenderer(renderOption: WzSelectBaseProps["renderOption"]) {
  if (!renderOption) return undefined;
  return (row: ComboRow, state: { focused: boolean; selected: boolean }) =>
    row.option ? renderOption(row.option, state) : row.label;
}

/**
 * A Workiz select (react-select v3 as Workiz styles it): Job type, Job source,
 * State, Country, Service area… Type to filter, arrows / Home / End / Page
 * keys to move, Enter or Tab to pick, Escape to close, Backspace to clear
 * when `clearable`. Drop-in for a react-hook-form `Controller`:
 * `render={({ field }) => <WzSelect label="Job type" options={…} {...field} />}`.
 */
export function WzSelect({
  label,
  options,
  value,
  defaultValue,
  onChange,
  onBlur,
  name,
  id,
  disabled = false,
  clearable = false,
  searchable = true,
  filterOption,
  onInputChange,
  noOptionsMessage,
  loading,
  valueLabel,
  createOption,
  shape = "rounded",
  geometry = "labelled",
  error,
  className,
  renderOption,
  ref,
}: WzSelectProps) {
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

  const chosen = options.find((o) => o.value === current);
  const display = chosen?.label ?? (current ? (valueLabel ?? current) : "");
  const hasValue = current !== "";

  const isSelected = useCallback((o: WzOption) => o.value === current, [current]);
  const { focused, onFocus, onBlurFlag } = useFocusFlag();
  const create = useMemo(
    () => (createOption ? { label: createOption.label ?? "+ Add new", onCreate: createOption.onCreate } : undefined),
    [createOption],
  );

  const combo = useCombobox({
    id: inputId,
    options,
    isSelected,
    onPick: (o) => set(o.value),
    filterOption: filterOption === undefined ? undefined : filterOption,
    searchable,
    disabled,
    create,
    onInputChange,
    onBlur: () => {
      onBlurFlag();
      onBlur?.();
    },
    onBackspaceEmpty: clearable && hasValue ? () => set("") : undefined,
  });

  const typing = combo.input !== "";
  const showClear = clearable && hasValue && !disabled;
  // Indicators: 1px border + 36px chevron + 1px separator, and 36px more for ×.
  const rightInset = showClear ? "right-[76px]" : "right-[40px]";

  return (
    <div
      ref={rootRef}
      data-slot="wz-select"
      data-wz-combobox-root=""
      data-has-value={hasValue ? "true" : "false"}
      data-focused={focused ? "true" : "false"}
      data-open={combo.open ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
      className={cn("group/wzsel relative min-w-0", className)}
      onMouseDown={(e) => combo.onControlMouseDown(e, rootRef)}
    >
      <ComboboxMenu
        combo={combo}
        labelId={labelId}
        isSelected={isSelected}
        noOptionsMessage={noOptionsMessage}
        loading={loading}
        renderRow={rowRenderer(renderOption)}
        anchor={
          <div
            data-slot="wz-select-control"
            className={cn(CONTROL, shape === "rounded" ? "rounded-[4px]" : "rounded-none")}
          >
            <div className="min-w-0 flex-1" />
            <div className="flex shrink-0 items-center">
              {showClear ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Clear ${label}`}
                  onMouseDown={(e) => {
                    // Keep focus in the input and do not toggle the menu.
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => {
                    set("");
                    combo.inputRef.current?.focus();
                  }}
                  className={INDICATOR}
                >
                  <RsCrossIcon />
                </button>
              ) : null}
              <span
                aria-hidden
                className="my-2 w-px self-stretch bg-input group-data-[disabled=true]/wzsel:bg-wz-disabled-border"
              />
              <span aria-hidden className={INDICATOR}>
                <RsChevronIcon />
              </span>
            </div>
          </div>
        }
      />
      <label
        id={labelId}
        htmlFor={inputId}
        className={cn(
          "pointer-events-none absolute truncate font-normal",
          geometry === "bare" && hasValue
            ? "sr-only"
            : hasValue
            ? "top-1 left-[10px] z-[9] max-w-[calc(100%-50px)] text-[12px] leading-4 text-wz-label"
            : cn(
                SHIFT_LEFT,
                rightInset,
                geometry === "plain" ? "top-[16.32px]" : "top-[15.32px]",
                "text-[16px] leading-4 text-wz-placeholder",
                typing && "opacity-0",
              ),
        )}
      >
        {label}
      </label>
      {hasValue && !typing ? (
        <div
          data-slot="wz-select-value"
          className={cn(
            "pointer-events-none absolute truncate text-[16px] leading-4 font-normal text-wz-value",
            "group-data-[disabled=true]/wzsel:text-wz-placeholder",
            SHIFT_LEFT,
            rightInset,
            geometry === "bare" ? "top-[16.32px]" : geometry === "plain" ? "top-[25.32px]" : "top-[24.32px]",
          )}
        >
          {display}
        </div>
      ) : null}
      <input
        {...combo.inputProps}
        ref={mergeRefs(combo.inputRef, ref)}
        onFocus={onFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "absolute h-4 min-w-0 bg-transparent p-0 text-[14px] leading-4 font-normal text-wz-value outline-none",
          geometry === "bare" ? "top-[16.32px]" : "top-[23.32px]",
          SHIFT_LEFT,
          rightInset,
          !searchable && "caret-transparent",
          disabled && "cursor-default",
        )}
      />
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
    </div>
  );
}

export interface WzMultiSelectProps extends WzSelectBaseProps {
  value?: string[] | null;
  defaultValue?: string[];
  onChange?: (value: string[]) => void;
  /** A × that clears every pick; react-select shows one on multi by default. */
  clearable?: boolean;
}

const EMPTY: string[] = [];

/**
 * The multi-select ("Assign team members", new_06_team_open): picks become
 * chips inside the box — white, 1px #ccc, 2px corners, a × behind a #ccc rule
 * (Workiz's `.react-select__multi-value` overrides) — and leave the list.
 * Backspace in the empty input drops the last chip.
 */
export function WzMultiSelect({
  label,
  options,
  value,
  defaultValue,
  onChange,
  onBlur,
  name,
  id,
  disabled = false,
  clearable = true,
  searchable = true,
  filterOption,
  onInputChange,
  noOptionsMessage,
  loading,
  shape = "rounded",
  error,
  className,
  renderOption,
  ref,
}: WzMultiSelectProps) {
  const autoId = useId();
  const inputId = id ?? `wz-${autoId}`;
  const labelId = `${inputId}-label`;
  const errorId = `${inputId}-error`;
  const rootRef = useRef<HTMLDivElement>(null);

  const [inner, setInner] = useState<string[]>(defaultValue ?? EMPTY);
  const current = value !== undefined ? (value ?? EMPTY) : inner;
  const set = (next: string[]) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };

  const isSelected = useCallback((o: WzOption) => current.includes(o.value), [current]);
  const { focused, onFocus, onBlurFlag } = useFocusFlag();
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  const combo = useCombobox({
    id: inputId,
    options,
    isSelected,
    hideSelected: true,
    onPick: (o) => set([...current, o.value]),
    filterOption: filterOption === undefined ? undefined : filterOption,
    searchable,
    disabled,
    onInputChange,
    onBlur: () => {
      onBlurFlag();
      onBlur?.();
    },
    onBackspaceEmpty: current.length ? () => set(current.slice(0, -1)) : undefined,
  });

  const hasValue = current.length > 0;
  const showClear = clearable && hasValue && !disabled;

  return (
    <div
      ref={rootRef}
      data-slot="wz-select"
      data-wz-combobox-root=""
      data-multi="true"
      data-has-value={hasValue ? "true" : "false"}
      data-focused={focused ? "true" : "false"}
      data-open={combo.open ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
      className={cn("group/wzsel relative min-w-0", className)}
      onMouseDown={(e) => combo.onControlMouseDown(e, rootRef)}
    >
      <ComboboxMenu
        combo={combo}
        labelId={labelId}
        isSelected={isSelected}
        multiple
        noOptionsMessage={noOptionsMessage}
        loading={loading}
        renderRow={rowRenderer(renderOption)}
        anchor={
          <div
            data-slot="wz-select-control"
            className={cn(CONTROL, "items-center", shape === "rounded" ? "rounded-[4px]" : "rounded-none")}
          >
            {/* react-select's multi value box: padding 2px 8px, wraps. */}
            <div className="relative flex min-h-7 min-w-0 flex-1 flex-wrap items-center px-2 py-0.5">
              <label
                id={labelId}
                htmlFor={inputId}
                className={cn(
                  "pointer-events-none absolute top-[6px] left-[10px] max-w-[calc(100%-20px)] truncate text-[16px] leading-4 font-normal text-wz-placeholder",
                  (hasValue || combo.input) && "sr-only",
                )}
              >
                {label}
              </label>
              {current.map((v) => (
                <div
                  key={v}
                  data-slot="wz-chip"
                  className="m-0.5 flex min-w-0 rounded-chip border border-input bg-white"
                >
                  <span className="truncate rounded-chip py-[3px] pr-[3px] pl-1.5 text-[85%] text-wz-value">
                    {labelOf(v)}
                  </span>
                  {!disabled ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`Remove ${labelOf(v)}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={() => set(current.filter((x) => x !== v))}
                      className="flex items-center rounded-chip border-l border-input bg-white px-1 text-wz-value"
                    >
                      <RsCrossIcon size={14} />
                    </button>
                  ) : null}
                </div>
              ))}
              <input
                {...combo.inputProps}
                ref={mergeRefs(combo.inputRef, ref)}
                onFocus={onFocus}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={cn(
                  "m-0.5 h-5 w-[2px] min-w-[2px] flex-1 bg-transparent py-0.5 text-[14px] leading-4 font-normal text-wz-value outline-none",
                  !searchable && "caret-transparent",
                )}
              />
            </div>
            <div className="flex shrink-0 items-center self-stretch">
              {showClear ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Clear ${label}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => {
                    set([]);
                    combo.inputRef.current?.focus();
                  }}
                  className={INDICATOR}
                >
                  <RsCrossIcon />
                </button>
              ) : null}
              <span aria-hidden className="my-2 w-px self-stretch bg-input" />
              <span aria-hidden className={INDICATOR}>
                <RsChevronIcon />
              </span>
            </div>
          </div>
        }
      />
      {name
        ? current.map((v) => <input key={v} type="hidden" name={name} value={v} />)
        : null}
      {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
    </div>
  );
}
