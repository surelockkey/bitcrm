"use client";

import { useId, useState, type ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { WzFieldError } from "./messages";
import { NotchedLabel, OUTLINE } from "./outlined";

/**
 * The text box of Workiz's newer modals (Input-module in its FloatingLabel
 * shell — "Sub-status name", pg_settings_catalogs_wz_substatus_add_open /
 * _row_open): 40px, 1px #9ea6aa, 4px corners, ink hovered, #6aa8ee focused;
 * 13px ink 12px in. The label rests inside at 13px #768287 while empty and
 * idle and sits in the notch (11px ink) on focus or with a value — the same
 * shell as `WzOutlinedSelect`. `helper` is the 12px/18px ink line under the
 * box ("Choose the parent job status…"), 12.5px in.
 */
export function WzOutlinedTextField({
  label,
  value,
  onChange,
  helper,
  error,
  disabled = false,
  className,
  id,
  ...rest
}: Omit<ComponentProps<"input">, "value" | "onChange" | "placeholder"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  helper?: string;
  error?: string;
}) {
  const autoId = useId();
  const inputId = id ?? `wz-${autoId}`;
  const helperId = `${inputId}-helper`;
  const errorId = `${inputId}-error`;
  const [focused, setFocused] = useState(false);
  const describedBy = [helper ? helperId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        data-slot="wz-outlined-text-field"
        data-focused={focused ? "true" : "false"}
        data-disabled={disabled ? "true" : "false"}
        className="group/wzo relative h-10"
      >
        <NotchedLabel htmlFor={inputId} floated={focused || value !== ""}>
          {label}
        </NotchedLabel>
        <input
          {...rest}
          id={inputId}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          className={cn(
            OUTLINE,
            "block h-10 w-full px-3 py-[10.5px] text-[13px] leading-4 text-foreground outline-none disabled:cursor-not-allowed disabled:text-wz-outline-disabled",
            "group-data-[focused=true]/wzo:border-wz-link",
          )}
        />
      </div>
      {helper ? (
        <small id={helperId} className="pl-[12.5px] text-xs leading-[18px] text-foreground">
          {helper}
        </small>
      ) : null}
      {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
    </div>
  );
}
