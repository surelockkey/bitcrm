"use client";

import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { groupBoxClass, groupWrapperClass, useGroupSlot } from "./field-group";
import { WzFieldError } from "./messages";

/**
 * The input box, from Workiz's `.sajInput` (build.css) as computed on
 * new_01_empty: 48px, 1px #ccc, 2px corners, padding 12px 10px 0, 16px/16px
 * #666, a #ffd400 edge while focused (`.sajInput.focus`, 0.3s).
 */
export const WZ_INPUT_BOX =
  "peer block h-12 w-full appearance-none rounded-[2px] border border-input bg-white pt-3 pr-2.5 pb-0 pl-2.5 text-[16px] leading-4 font-normal text-wz-text shadow-none outline-none transition-[border-color] duration-300 focus:border-wz-focus disabled:cursor-not-allowed disabled:border-wz-disabled-border disabled:bg-wz-disabled autofill:shadow-[inset_0_0_0_30px_#fff]";

/**
 * The label inside it, from `._fLabel label.label` (reactCss.css): 16px/20px
 * #8c8c8c at .95rem/.65rem, sliding to 12px at the top (2px) when the input
 * is focused, hovered or filled (`._fLabel.filled input+label`,
 * `._fLabel input:hover+label`), over 0.3s.
 */
export const WZ_FLOAT_LABEL =
  "pointer-events-none absolute left-[0.65rem] top-[0.95rem] max-w-[calc(100%-20px)] truncate text-[16px] leading-5 font-normal text-wz-label transition-all duration-300 ease-[ease] peer-focus:top-[2px] peer-focus:text-[12px] peer-[:hover:enabled]:top-[2px] peer-[:hover:enabled]:text-[12px] peer-[:not(:placeholder-shown)]:top-[2px] peer-[:not(:placeholder-shown)]:text-[12px]";

export interface WzTextFieldProps extends Omit<ComponentProps<"input">, "placeholder"> {
  /** The words in the box; they float to the top-left once it is in use. */
  label: string;
  /** "Required field" under the box, tied to it with aria-describedby. */
  error?: string;
  /**
   * Icons inside the box on the right — the job page's call and SMS buttons
   * on Phone. Typed text stops short of them.
   */
  endAdornment?: ReactNode;
  /** Classes for the <input> itself; `className` goes on the wrapper (width, flex). */
  inputClassName?: string;
  /**
   * Workiz's `.sajInput.sizef` is content-box sized — `calc(100% - 20px)` plus
   * 20px padding and 2px border — so every standalone text box is 2px wider
   * than its column (599 in a 597 card, sticking out past the selects).
   * On by default to match; inside a WzFieldGroup it is always off.
   */
  overhang?: boolean;
}

/**
 * A Workiz text field with its floating label. Drop-in for
 * `{...register("name")}` (name, onChange, onBlur, ref) or plain
 * `value`/`onChange`; the label follows the value either way, because the
 * float is CSS on the input's own state rather than a React copy of it.
 */
export function WzTextField({
  label,
  error,
  endAdornment,
  className,
  inputClassName,
  overhang = true,
  id,
  disabled,
  type = "text",
  ref,
  "aria-describedby": describedBy,
  ...rest
}: WzTextFieldProps) {
  const autoId = useId();
  const inputId = id ?? `wz-${autoId}`;
  const errorId = `${inputId}-error`;
  const slot = useGroupSlot();

  return (
    <div
      data-slot="wz-text-field"
      data-disabled={disabled ? "true" : undefined}
      // 3.04rem: Workiz's field wrapper is as tall as a select (48.64px), so
      // rows of inputs and rows of selects step down alike, 58.64px apart.
      className={cn("relative min-h-[3.04rem] min-w-0", slot && "flex-1", groupWrapperClass(slot), className)}
    >
      <input
        {...rest}
        ref={ref}
        id={inputId}
        type={type}
        disabled={disabled}
        // A single space, never shown: it makes `:placeholder-shown` mean
        // "empty", which is what floats the label.
        placeholder=" "
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, describedBy) || undefined}
        className={cn(
          WZ_INPUT_BOX,
          overhang && !slot && "w-[calc(100%+2px)] max-w-none",
          endAdornment ? "pr-[92px]" : undefined,
          groupBoxClass(slot),
          inputClassName,
        )}
      />
      <label htmlFor={inputId} className={WZ_FLOAT_LABEL}>
        {label}
      </label>
      {endAdornment ? (
        // The job page's phone icons: 40px buttons, 7px down, 12px in from the edge.
        <div className="absolute top-[7px] right-3 flex items-center">{endAdornment}</div>
      ) : null}
      {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
    </div>
  );
}
