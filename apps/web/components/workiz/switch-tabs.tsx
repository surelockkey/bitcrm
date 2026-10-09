"use client";

import type { KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

/*
 * Two small Workiz ui-components the Map's sidebar is built from (main.css,
 * pg_dispatch_wz_02_loaded / _11_techs):
 *
 *   SwitchTabs  "Jobs | Techs": a #f3f6f7 box (4px corners, 2px in, 10px
 *               between), equal tabs 10px 30px, 13px/19px ink; the chosen
 *               one white, 2px corners, 0 2px 4px rgba(59,75,82,.1), 14px
 *               semibold #6aa8ee.
 *   Toggle      "Show leads": a 32×16 switch, 8px corners, #3acf7d on /
 *               #768287 off, a 12px white knob 2px in sliding 16px in .4s.
 */

export interface WzSwitchTab<T extends string> {
  value: T;
  label: string;
}

export function WzSwitchTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  tabs: readonly WzSwitchTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    onChange(next.value);
    const sibling = e.currentTarget.parentElement?.children[(i + step + tabs.length) % tabs.length];
    (sibling as HTMLElement | undefined)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-slot="wz-switch-tabs"
      className={cn("flex justify-between gap-2.5 rounded-[4px] bg-wz-secondary-hover p-0.5", className)}
    >
      {tabs.map((t, i) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative flex-1 cursor-pointer px-[30px] py-2.5 text-center leading-[19px] tracking-[0.4px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              on
                ? "rounded-[2px] bg-white text-sm leading-[19px] font-semibold text-wz-link shadow-[0_2px_4px_rgba(59,75,82,0.1)]"
                : "text-[13px] leading-[19px] font-normal text-foreground",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function WzMiniToggle({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  className,
}: {
  /** The row's words — the switch's accessible name. */
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      data-slot="wz-mini-toggle"
      className={cn(
        "relative h-4 w-8 shrink-0 cursor-pointer rounded-[8px] transition-all duration-[400ms] outline-none focus-visible:shadow-[0_0_1px_var(--wz-tag-success)] disabled:cursor-not-allowed",
        checked ? "bg-wz-tag-success" : "bg-wz-outline-label",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 left-0.5 size-3 rounded-full bg-white transition-all duration-[400ms]",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
