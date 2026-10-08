"use client";

import type { ChangeEvent, ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface WzSwitchProps extends Omit<ComponentProps<"input">, "type" | "size"> {
  /** The new state, alongside the native onChange (which react-hook-form's register uses). */
  onCheckedChange?: (checked: boolean) => void;
  /** Wrapper classes. */
  className?: string;
}

/**
 * The green "Scheduled" / "Schedule" toggle (toggleSwitch-module, small):
 * 40×20, fully round, #50d58c on / #bbbbbb off, a 16px white knob 2px in,
 * sliding in 50ms. Disabled: #dddddd off, #b2e5c0 on. Keyboard focus glows
 * yellow round the knob, as Workiz's `:focus > span` does.
 *
 * A native checkbox (role="switch") under the paint, so `{...register("x")}`,
 * `checked`/`onCheckedChange` and plain `defaultChecked` all work. Name it
 * with `aria-label` — Workiz shows it beside the card title, not with words.
 */
export function WzSwitch({ className, onChange, onCheckedChange, ref, ...rest }: WzSwitchProps) {
  return (
    <label
      data-slot="wz-switch"
      className={cn(
        "relative inline-block h-5 w-10 shrink-0 cursor-pointer has-[:disabled]:cursor-not-allowed",
        className,
      )}
    >
      <input
        {...rest}
        ref={ref}
        type="checkbox"
        role="switch"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onChange?.(e);
          onCheckedChange?.(e.target.checked);
        }}
        className="peer absolute inset-0 m-0 size-full cursor-[inherit] opacity-0"
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[20px] bg-wz-switch-off transition-colors duration-50 ease-in",
          "peer-checked:bg-wz-switch-on",
          // Disabled greys, from the same stylesheet.
          "peer-disabled:bg-[#dddddd] peer-disabled:peer-checked:bg-[#b2e5c0]",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-[20px] bg-white transition-[left,box-shadow] duration-50 ease-in",
          "peer-checked:left-[22px] peer-focus-visible:shadow-[0_0_2px_5px_#ffff00]",
        )}
      />
    </label>
  );
}

export interface WzCheckboxProps extends Omit<ComponentProps<"input">, "type" | "size"> {
  /** "All-day event". */
  label: ReactNode;
  onCheckedChange?: (checked: boolean) => void;
  /** Wrapper classes. */
  className?: string;
}

/**
 * "All-day event": Workiz's checkbox is the browser's own 13×13 box — their
 * SVG skin is a ::before on a non-appearance:none input, which Chrome never
 * paints — set 2px in and 3.2px down a 15px column, then the words 28.2px in
 * at 14px/21px ink (Checkbox-module). Native, so register() just works.
 */
export function WzCheckbox({ label, className, onChange, onCheckedChange, ref, ...rest }: WzCheckboxProps) {
  return (
    <label
      data-slot="wz-checkbox"
      className={cn(
        "inline-grid cursor-pointer grid-cols-[15px_13.2px_auto] items-start has-[:disabled]:cursor-not-allowed",
        className,
      )}
    >
      <input
        {...rest}
        ref={ref}
        type="checkbox"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onChange?.(e);
          onCheckedChange?.(e.target.checked);
        }}
        className="col-start-1 mt-[3.2px] ml-[2px] size-[13px] cursor-[inherit]"
      />
      <span className="col-start-3 text-[14px] leading-[21px] font-normal text-foreground">{label}</span>
    </label>
  );
}
