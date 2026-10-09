"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface WzRadioButtonsOption<V extends string> {
  value: V;
  label: string;
}

/**
 * Workiz's `div._btnRadio` — the two-way choice at the top of "Add team
 * member" (User | Subcontractor, subcontractor_wz_04b_add_new_subcontractor):
 * a 38px box with a 1px #ddd frame and 4px corners, split into equal parts of
 * 14px/16px regular #404040 with 10px padding, the chosen part filled Workiz
 * yellow #ffd400 (the `_selected` class; a hair brighter than the button
 * yellow, the same as the focus edge).
 *
 * A radio group: one Tab stop, the arrow keys move and choose. (Not
 * `WzButtonGroup` — the legacy reports' grey #ececec label buttons — nor
 * `WzSegmented`, the Files panel's blue tab list.)
 */
export function WzRadioButtons<V extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: {
  options: readonly WzRadioButtonsOption<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
  "aria-label": string;
  "aria-describedby"?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = options.findIndex((o) => o.value === value);

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const focused = refs.current.indexOf(e.target as HTMLButtonElement);
    const from = focused >= 0 ? focused : Math.max(at, 0);
    const next = (from + step + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      onKeyDown={move}
      className={cn("flex overflow-hidden rounded-[4px] border border-wz-frame", className)}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (at < 0 && i === 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 cursor-pointer p-2.5 text-center text-[14px] leading-4 font-normal tracking-[0.4px] text-wz-strong outline-none",
              "focus-visible:ring-1 focus-visible:ring-wz-focus focus-visible:ring-inset",
              // Workiz's `_selected`, sampled rgb(255, 212, 0).
              on ? "bg-[#ffd400]" : "bg-white",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
