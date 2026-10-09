"use client";

import { useId, useRef, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/** One colour of a `WzColorDots` row: a hex `color`, or a palette `className` (a `bg-*`). */
export interface WzColorDotOption {
  value: string;
  label: string;
  color?: string;
  className?: string;
}

/**
 * Workiz's "Choose color" (ColorInput-module, the Sub Status modal —
 * pg_settings_catalogs_wz_substatus_add_open / _row_open): a 13px/19px 600
 * ink heading, 15px over rows of 24px round dots 8px apart. The chosen one
 * is a white ring inside a 1px edge of its colour round a 16px dot of it
 * (`innerSelectedColor`: 4px in).
 *
 * A radio group: one tab stop (the chosen dot), arrows move and pick.
 */
export function WzColorDots({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** The heading over the dots, and the group's name ("Choose color"). */
  label: string;
  options: readonly WzColorDotOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const headingId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const move = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div className={cn("flex flex-col gap-[15px]", className)}>
      <p id={headingId} className="text-[13px] leading-[19px] font-semibold text-foreground">
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={headingId} className="flex flex-wrap gap-2">
        {options.map((o, i) => {
          const chosen = o.value === value;
          const paint = { style: o.color ? { backgroundColor: o.color } : undefined, className: o.className };
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={o.label}
              title={o.label}
              tabIndex={i === at ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => move(e, i)}
              style={paint.style}
              className={cn(
                "relative size-6 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-wz-focus focus-visible:ring-offset-1",
                paint.className,
              )}
            >
              {chosen ? (
                <>
                  <span data-slot="wz-color-dot-ring" aria-hidden className="absolute inset-px rounded-full bg-white" />
                  <span
                    data-slot="wz-color-dot-inner"
                    aria-hidden
                    style={paint.style}
                    className={cn("absolute inset-1 rounded-full", paint.className)}
                  />
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
