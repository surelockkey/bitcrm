"use client";

import { useCallback, useId, useRef, useState, type Ref } from "react";

import { cn } from "@/lib/utils";
import { ComboboxMenu, useCombobox, type WzOption } from "./combobox";
import { ThinChevronIcon } from "./icons";
import { WzFieldError } from "./messages";
import { NotchedLabel, OUTLINE } from "./outlined";
import { mergeRefs } from "./refs";

export interface WzOutlinedSelectProps {
  /** "Select user", "Reason". */
  label: string;
  /**
   * Words inside the empty box. With one, the label sits in the notch from the
   * start ("Select user" over "Select user"); without, it rests inside until
   * something is picked ("Reason").
   */
  placeholder?: string;
  options: WzOption[];
  /** The chosen value; "" for none. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  error?: string;
  className?: string;
  ref?: Ref<HTMLInputElement>;
  /**
   * The label names the box for a screen reader but is not drawn — Workiz's
   * catalog status box (Active / All / Disabled, pg_pricebook_wz_30) shows
   * only its value. Off by default.
   */
  labelHidden?: boolean;
  /**
   * Classes merged into the box itself — its height above all: Workiz draws
   * the same shell 49px tall beside a 48px floating-label text box ("+1"
   * on Add team member, subcontractor_wz_04_add_new_user). Default 42px.
   */
  controlClassName?: string;

  /** Words that explain the box (a reason it is locked); joined with the error's. */
  "aria-describedby"?: string;
}

/**
 * The select of Workiz's newer forms — react-select in its FloatingLabel
 * shell, as on Add time off (pg_schedule_wz_13_timeoff_open): the 42px box of
 * `WzTimeSelect` (1px #9ea6aa, ink hovered, #6aa8ee open), the label in the
 * notch, the value 13px ink 12px in, a thin chevron; its menu the time list's
 * (32px 13px rows). Type to narrow.
 */
export function WzOutlinedSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  onBlur,
  name,
  id,
  disabled = false,
  error,
  className,
  ref,
  labelHidden = false,
  controlClassName,

  "aria-describedby": describedBy,
}: WzOutlinedSelectProps) {
  const autoId = useId();
  const inputId = id ?? `wz-${autoId}`;
  const labelId = `${inputId}-label`;
  const errorId = `${inputId}-error`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const isSelected = useCallback((o: WzOption) => o.value === value, [value]);

  const combo = useCombobox({
    id: inputId,
    options,
    isSelected,
    onPick: (o) => onChange(o.value),
    disabled,
    onBlur: () => {
      setFocused(false);
      onBlur?.();
    },
  });

  const chosen = options.find((o) => o.value === value);
  const typing = combo.input !== "";

  return (
    <div
      ref={rootRef}
      data-slot="wz-outlined-select"
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
          <div className={cn(OUTLINE, "relative h-[42px] w-full text-[13px] leading-4 text-wz-strong", controlClassName)}>
            <span
              aria-hidden
              className="absolute top-1/2 right-[9px] flex -translate-y-1/2 text-foreground group-data-[disabled=true]/wzo:text-wz-outline-disabled"
            >
              <ThinChevronIcon up={combo.open} />
            </span>
          </div>
        }
      />
      {labelHidden ? (
        <label id={labelId} htmlFor={inputId} className="sr-only">
          {label}
        </label>
      ) : (
        <NotchedLabel id={labelId} htmlFor={inputId} floated={!!chosen || !!placeholder || focused || combo.open}>
          {label}
        </NotchedLabel>
      )}
      {/* The value and the placeholder sit on the box's middle (13px down in
          the 42px box), whatever height `controlClassName` gives it. */}
      {!typing ? (
        chosen ? (
          <div className="pointer-events-none absolute top-1/2 right-10 left-3 -translate-y-1/2 truncate text-[13px] leading-4 text-foreground">
            {chosen.label}
          </div>
        ) : placeholder ? (
          <div
            data-slot="wz-outlined-placeholder"
            className="pointer-events-none absolute top-1/2 right-10 left-3 -translate-y-1/2 truncate text-[13px] leading-4 text-wz-outline-label"
          >
            {placeholder}
          </div>
        ) : null
      ) : null}
      <input
        {...combo.inputProps}
        ref={mergeRefs(combo.inputRef, ref)}
        onFocus={() => setFocused(true)}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, describedBy) || undefined}
        className="absolute inset-y-0 right-10 left-3 min-w-0 bg-transparent p-0 text-[13px] leading-4 text-wz-value outline-none"
      />
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
    </div>
  );
}
