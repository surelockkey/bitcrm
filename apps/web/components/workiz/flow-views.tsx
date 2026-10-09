"use client";

import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export interface WzFlowViewsOption<V extends string> {
  value: V;
  label: string;
}

/**
 * The Call Tracking report's graph step, "hour | day | week | month"
 * (`div._flowViews`, rep_calltracking_wz_01_default / _04b_step_hover):
 * a 272×28 white box, 1px #ccc edge, 6px corners; equal parts of 14px/16px
 * words 5px from top and bottom, a 1px #ccc rule after each but the last;
 * the chosen part — and the one under the mouse — #ddd.
 *
 * A radio group: one Tab stop, the arrow keys move and choose.
 */
export function WzFlowViews<V extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: readonly WzFlowViewsOption<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
  "aria-label": string;
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
      onKeyDown={move}
      data-slot="wz-flow-views"
      className={cn("flex h-7 w-[272px] rounded-[6px] border border-input bg-background", className)}
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
              "min-w-0 flex-1 basis-0 cursor-pointer py-[5px] text-center text-sm leading-4 font-normal text-wz-strong outline-none",
              "hover:bg-[#dddddd] focus-visible:ring-1 focus-visible:ring-wz-focus focus-visible:ring-inset",
              i < options.length - 1 && "border-r border-input",
              on && "bg-[#dddddd]",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
