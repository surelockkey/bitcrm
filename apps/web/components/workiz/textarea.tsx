"use client";

import { useId, type ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { WzFieldError } from "./messages";

export interface WzTextareaProps extends ComponentProps<"textarea"> {
  /** "Required field" under the box. */
  error?: string;
  /** Classes for the wrapper (width, margins); `className` is the textarea's. */
  wrapperClassName?: string;
}

/**
 * Workiz's plain textarea — the custom-field notes ("Manager Note", "Work
 * Order Link", "WO SERVICE DESCRIPTION"), new_01_empty_scroll1 and
 * formkit_textarea_focus: 1px #ccc, 4px corners, padding 7px 10px, 14px/18px
 * #666, placeholder inside in #808080, 100px tall, no resize grip, a #ffd400
 * edge while focused. Named by its placeholder unless given a label.
 * Drop-in for `{...register("note")}`.
 */
export function WzTextarea({
  className,
  wrapperClassName,
  error,
  id,
  placeholder,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  ref,
  ...rest
}: WzTextareaProps) {
  const autoId = useId();
  const boxId = id ?? `wz-${autoId}`;
  const errorId = `${boxId}-error`;
  return (
    <div data-slot="wz-textarea" className={cn("min-w-0", wrapperClassName)}>
      <textarea
        {...rest}
        ref={ref}
        id={boxId}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(error && errorId, describedBy) || undefined}
        className={cn(
          "block h-[100px] w-full resize-none appearance-none rounded-[4px] border border-input bg-white px-2.5 py-[7px] text-[14px] leading-[18px] font-normal text-wz-text shadow-none outline-none placeholder:text-wz-placeholder focus:border-wz-focus disabled:cursor-not-allowed disabled:border-wz-disabled-border disabled:bg-wz-disabled",
          className,
        )}
      />
      {error ? <WzFieldError id={errorId}>{error}</WzFieldError> : null}
    </div>
  );
}
