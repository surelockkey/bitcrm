"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface WzButtonGroupOption<V extends string> {
  value: V;
  label: string;
}

/**
 * The legacy pages' `span.button-group` of `label.button` radios — Job
 * Statistics' "By Time: Created | Scheduled | Closed", "Day | Week | Month"
 * and "Metro | City | Zip" (rep_jobstats_wz_02_overview_day,
 * _03_bytime_hover): 32px boxes, 13px/32px regular, 0.5px tracking, 0 15px;
 * #ececec in black with a 2px white rule on the right (the last one too),
 * the outer corners 2px; the chosen one (and the one under the mouse) #ddd,
 * the chosen one's words #404040, its rule gone and all four corners 2px.
 *
 * A radio group: one Tab stop, the arrow keys move and choose.
 */
export function WzButtonGroup<V extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: readonly WzButtonGroupOption<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
  "aria-label": string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = options.findIndex((o) => o.value === value);

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    // From the button that has the focus — the chosen one until the keys move it.
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
      onKeyDown={move}
      className={cn("inline-flex align-middle", className)}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        const last = i === options.length - 1;
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
              "h-8 cursor-pointer px-[15px] text-[13px] leading-8 font-normal tracking-[0.5px] whitespace-nowrap outline-none",
              "focus-visible:ring-1 focus-visible:ring-wz-focus focus-visible:ring-inset",
              on
                ? "rounded-[2px] bg-[#dddddd] text-wz-strong"
                : cn(
                    // #ececec: label.button at rest (rep_jobstats_wz_02_overview_day).
                    "border-r-2 border-white bg-[#ececec] text-black hover:bg-[#dddddd]",
                    i === 0 && "rounded-l-[2px]",
                    last && "rounded-r-[2px]",
                  ),
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
