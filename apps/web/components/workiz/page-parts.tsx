"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/*
 * The frame of a Workiz section page — Workiz Phone (callspage_wz_01) is the
 * model: an h2 with a grey pill beside it, a legacy tab strip, stat cards,
 * and a round icon button with a red count.
 */

/**
 * The page heading (callspage_wz_01): h2 25px/32px 500 ink, 24px in and 15px
 * under the breadcrumb, a pill (165×36 for the number) 16px to its right,
 * anything else pushed to the right edge.
 */
export function WzPageHeader({ title, pill, end }: { title: string; pill?: ReactNode; end?: ReactNode }) {
  return (
    // shrink-0: in a scrolling flex column the 36px floor would otherwise be
    // all it got, its 15px top eaten.
    <div className="sticky left-0 flex min-h-9 shrink-0 items-center gap-4 px-6 pt-[15px]">
      <h2 className="text-[25px] leading-8 font-medium text-foreground">{title}</h2>
      {pill}
      {end ? <div className="ml-auto">{end}</div> : null}
    </div>
  );
}

/**
 * The grey pill beside the heading (`workizNumber`): `#f3f6f7`, radius 8,
 * 0 12px, 36px, 14px/16px ink, a glyph 8px before the words.
 */
export function WzHeaderPill({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-[8px] bg-wz-secondary-hover px-3 text-sm leading-4 text-foreground">
      {icon}
      {children}
    </div>
  );
}

/**
 * Workiz's legacy tab strip as links (`_tabs`, callspage_wz_tab_*): flush
 * with the content's left edge, 24px under the heading, a 1px #ccc rule
 * under it; tabs 15px 25px, 13px/16px — idle 500 `#768287`, the open one 600
 * `#404040` over a 4px `#3e4b51` bar.
 */
export function WzTabLinks({
  tabs,
  active,
  label,
}: {
  tabs: { id: string; label: string; href: string }[];
  active: string | null;
  /** The strip's accessible name. */
  label: string;
}) {
  return (
    <nav aria-label={label} className="sticky left-0 mt-6 flex shrink-0 overflow-x-auto border-b border-input">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative shrink-0 px-[25px] py-[15px] text-[13px] leading-4 whitespace-nowrap",
              on
                ? "font-semibold text-wz-strong after:absolute after:inset-x-0 after:-bottom-px after:h-1 after:bg-wz-tab-bar"
                : "font-medium text-wz-outline-label hover:text-wz-strong",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * A stat card (`StatCard-module`, callspage_wz_01): white, 1px `#e8e8e8`,
 * radius 8, 16px; the label 10px/14px 500 uppercase `#566d76`, 8px over the
 * number 25px/30px 500 ink; words at the right of the number 13px/19px
 * `#768287` ("226 callers"). An alert (missed calls) turns label and number
 * `#f45e44`.
 */
export function WzStatCard({
  label,
  value,
  aside,
  alert = false,
  className,
}: {
  label: string;
  value: string;
  aside?: string;
  alert?: boolean;
  className?: string;
}) {
  const tone = alert ? "text-wz-danger" : undefined;
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("min-w-0 flex-1 rounded-[8px] border border-[#e8e8e8] bg-background p-4", className)}
    >
      <small className={cn("block text-[10px] leading-[14px] font-medium tracking-[0.4px] text-wz-slate uppercase", tone)}>
        {label}
      </small>
      <div className="mt-2 flex h-[30px] items-center justify-between gap-3">
        <span className={cn("text-[25px] leading-[30px] font-medium whitespace-nowrap text-foreground tabular-nums", tone)}>{value}</span>
        {aside ? <span className="truncate text-[13px] leading-[19px] text-wz-outline-label">{aside}</span> : null}
      </div>
    </div>
  );
}

/**
 * A large grey icon button with a red count (`IconButton-module` large gray
 * + `monitorCallsIndicator`, callspage_wz_01): 40×40, radius 8, `#dfe2e3`
 * under the cursor; the count a 22px `#f45e44` disc with a 2px `#f3f6f7`
 * ring, 10px/500 white, hung over the top-right corner. No count, no disc.
 */
export function WzBadgeIconButton({
  label,
  icon,
  count = 0,
  onClick,
  expanded,
}: {
  label: string;
  icon: ReactNode;
  count?: number;
  onClick?: () => void;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={onClick}
      className="relative grid size-10 shrink-0 place-items-center rounded-[8px] text-foreground hover:bg-border"
    >
      {icon}
      {count > 0 ? (
        <span
          aria-hidden
          // A disc at one digit, a capsule past it: half the height as the corner.
          className="absolute -top-1.5 left-6 grid h-[22px] min-w-[22px] place-items-center rounded-[11px] border-2 border-wz-secondary-hover bg-wz-danger px-1 text-[10px] leading-none font-medium text-white tabular-nums"
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
