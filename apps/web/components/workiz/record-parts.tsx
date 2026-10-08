"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * Pieces of a Workiz record page (the client page, pg_contact_wz_269669_*):
 * the totals over the tabs, the folds of the left column, the segmented
 * switch of the Files panel.
 */

/**
 * The totals row (`client-module__totals`): boxes side by side, the first
 * 76px in from the column's edge, each next one 80px after the previous
 * one's figure. A `group`, named by the caller.
 */
export function WzTotalsBar({ className, ...props }: ComponentProps<"div"> & { "aria-label": string }) {
  return <div role="group" data-slot="wz-totals-bar" className={cn("flex flex-wrap items-start gap-x-20 gap-y-3 pl-[76px]", className)} {...props} />;
}

/**
 * One total (`LeftBorderBox`): a 10px/14px 500 #9ea6aa capital caption, and
 * 10px under it the figure, 28px light (300) ink — #f45e44 for `danger`
 * (Workiz's PAST DUE is always red, $0.00 too).
 */
export function WzLeftBorderBox({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: "danger" }) {
  return (
    <div data-slot="wz-left-border-box" className="flex flex-col">
      <small data-slot="kpi-label" className="text-[10px] leading-[14px] font-medium tracking-[0.4px] whitespace-nowrap text-wz-outline uppercase">
        {label}
      </small>
      <span
        data-tone={tone}
        className={cn(
          "mt-[11px] text-[28px] leading-[25px] font-light tracking-[0.4px] whitespace-nowrap tabular-nums",
          tone === "danger" ? "text-wz-danger" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * A folding section of the left column ("> Addresses", "Additional contacts
 * (6) +"): a 1px #dfe2e3 rule over it, a chevron 19px in, the title 14px/21px
 * 600 ink, 17px above and 16px below; `action` (a 32px "+") at the right,
 * outside the title's button so it never folds the section.
 */
export function WzFold({
  title,
  defaultOpen = false,
  action,
  children,
  className,
}: {
  title: string;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section data-slot="wz-fold" className={cn("border-t border-border", className)}>
      <div className="flex min-h-[54px] items-center gap-2 pr-[17px]">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-[54px] flex-1 items-center gap-1.5 py-4 pl-[19px] text-left text-sm leading-[21px] font-semibold tracking-[0.4px] text-foreground outline-none focus-visible:underline"
        >
          <Chevron className="size-5 shrink-0" strokeWidth={1.25} aria-hidden />
          {title}
        </button>
        {action}
      </div>
      {open ? <div className="space-y-4 pr-[17px] pb-4 pl-[19px]">{children}</div> : null}
    </section>
  );
}

/**
 * Workiz's segmented switch (the Files panel's All | Media | Documents): a
 * #f3f6f7 box, 2px in, r4; the chosen part white with a soft shadow, 14px
 * 600 #6aa8ee; the rest 13px ink; 39px tall, 25px sides. Tabs, not buttons.
 */
export function WzSegmented<V extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
  "aria-label": string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} data-slot="wz-segmented" className={cn("flex rounded-[4px] bg-wz-secondary-hover p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-[39px] flex-1 rounded-[2px] px-[25px] leading-[19px] tracking-[0.4px] whitespace-nowrap outline-none focus-visible:underline",
              on ? "bg-white text-sm font-semibold text-wz-link shadow-[0_2px_4px_rgba(59,75,82,0.1)]" : "text-[13px] text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
