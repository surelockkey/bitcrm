"use client";

import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { WzFieldError } from "./messages";

/**
 * The box itself (Input-module__input inside FloatingLabel-module, the user
 * page — pg_technicians_wz_measure_user.json): 40px, 1px #9ea6aa, 4px
 * corners, 13px/16px ink 12px in; the edge goes ink under the cursor and
 * #6aa8ee while focused, as `WzOutlinedSelect`'s does.
 */
const BOX =
  "peer block h-10 w-full min-w-0 rounded-[4px] border border-wz-outline bg-white px-3 text-[13px] leading-4 tracking-[0.4px] text-foreground outline-none transition-colors placeholder:text-wz-outline-label hover:border-foreground focus:border-wz-link disabled:cursor-not-allowed disabled:border-wz-outline-disabled disabled:bg-wz-disabled-fill disabled:text-wz-outline-label aria-invalid:border-wz-error";

/** In the notch: 11px ink on white, 4px either side, 8px in and 8px up. */
const FLOATED = "-top-2 left-2 h-auto bg-white px-1 py-0 text-[11px] leading-[normal] text-foreground";

/**
 * Resting inside the empty box (13px #768287, 10.25px 12px — "Additional
 * phone numbers"), floated into the notch by the input's own state: focused,
 * or holding something. CSS, not a copy of the value, so `register()`,
 * `reset()` and autofill move it without a render.
 */
const RESTING =
  "top-0 left-0 h-full items-center bg-transparent py-[10.25px] pr-0 pl-3 text-[13px] leading-[initial] text-wz-outline-label " +
  "peer-focus:-top-2 peer-focus:left-2 peer-focus:h-auto peer-focus:bg-white peer-focus:px-1 peer-focus:py-0 peer-focus:text-[11px] peer-focus:leading-[normal] peer-focus:text-foreground " +
  "peer-[:not(:placeholder-shown)]:-top-2 peer-[:not(:placeholder-shown)]:left-2 peer-[:not(:placeholder-shown)]:h-auto peer-[:not(:placeholder-shown)]:bg-white peer-[:not(:placeholder-shown)]:px-1 peer-[:not(:placeholder-shown)]:py-0 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:leading-[normal] peer-[:not(:placeholder-shown)]:text-foreground";

export interface WzOutlinedTextFieldProps extends ComponentProps<"input"> {
  /** "Name", "Email", "Home address". Without one the box is bare (Labor cost's "00.00") — name it with `aria-label`. */
  label?: string;
  error?: string;
  /** Inside the box at the right (Workiz's phone glyph on Phone); typed text stops short of it. */
  endAdornment?: ReactNode;
  /** Classes for the <input>; `className` goes on the wrapper (width). */
  inputClassName?: string;
}

/**
 * The text field of Workiz's newer forms — the user page's Name, Email, Home
 * address and Phone (pg_technicians_wz_10_user_profile): the notched outline
 * of `WzOutlinedSelect` around a text box. Drop-in for `{...register()}`.
 * A `placeholder` keeps the label in the notch from the start.
 */
export function WzOutlinedTextField({
  label,
  error,
  endAdornment,
  className,
  inputClassName,
  placeholder,
  id,
  ref,
  "aria-describedby": describedBy,
  ...rest
}: WzOutlinedTextFieldProps) {
  const autoId = useId();
  const inputId = id ?? `wz-${autoId}`;
  const errorId = `${inputId}-error`;
  const floatedFromStart = !!placeholder;

  return (
    <div data-slot="wz-outlined-text-field" className={cn("relative min-w-0", className)}>
      <input
        {...rest}
        ref={ref}
        id={inputId}
        // A single space, never shown: it makes `:placeholder-shown` mean "empty".
        placeholder={placeholder ?? " "}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, describedBy) || undefined}
        className={cn(BOX, endAdornment ? "pr-11" : undefined, inputClassName)}
      />
      {label ? (
        <label
          htmlFor={inputId}
          data-floated={floatedFromStart ? "true" : undefined}
          className={cn(
            "pointer-events-none absolute z-[1] box-border flex max-w-[calc(100%-16px)] truncate tracking-[0.4px] transition-[font-size,padding,top,left,background] duration-200",
            floatedFromStart ? FLOATED : RESTING,
          )}
        >
          {label}
        </label>
      ) : null}
      {endAdornment ? <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center">{endAdornment}</div> : null}
      {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
    </div>
  );
}
