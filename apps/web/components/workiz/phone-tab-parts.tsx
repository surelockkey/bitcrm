"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/*
 * Pieces of Workiz Phone's settings tabs — Phone numbers, Call flows, Call
 * groups, Texting (pg_settings_phone_wz_numbers / _flows / _groups /
 * _texting), measured at 1600×1000.
 */

/**
 * The row under the tab strip: Workiz's words (14px/20px ink, 40px in, at
 * most 620px wide), 32px under the tab rule and 32px over the grid's strip,
 * and the tab's big yellow button 20px from the right edge, level with the
 * words' first line ("Add number", "+ Create Call Flow", "Create a group").
 */
export function WzTabIntro({ action, className, children }: { action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div data-slot="wz-tab-intro" className={cn("flex items-start justify-between gap-6 py-8 pr-5", className)}>
      <p className="max-w-[660px] pl-10 text-sm leading-5 tracking-[0.4px] text-foreground">{children}</p>
      {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
    </div>
  );
}

const ROW_ICON =
  "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-foreground outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed disabled:text-wz-outline-disabled [&_svg]:shrink-0";

/**
 * A grid row's 24px icon — Workiz's pencil / bin / copy on the flows and
 * groups lists (`edit.svg`, `trash.svg`, `copy.svg`, `wfi-edit`, `wfi-delete`).
 * A link with `href` (the flows list's pencil opens the builder), a button
 * otherwise; either way its click never reaches the row.
 */
export function WzRowIconButton({
  label,
  href,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const stop = (e: MouseEvent) => e.stopPropagation();
  if (href && !disabled) {
    return (
      <Link href={href} aria-label={label} title={label} onClick={stop} className={cn(ROW_ICON, className)}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        stop(e);
        onClick?.();
      }}
      className={cn(ROW_ICON, className)}
    >
      {children}
    </button>
  );
}

/**
 * Workiz's dark `tag`: 14px/16px 500 white on #61747d, 3px corners, 1px 4px
 * in — the numbers list's "Workiz Number" under the account's own number,
 * and every short-code chip.
 */
// #61747d: Workiz's `tag` fill (pg_settings_phone_wz_numbers_scroll1, _texting_scroll1), a one-off.
const TAG = "rounded-[3px] bg-[#61747d] px-1 py-px text-sm leading-4 font-medium tracking-[0.4px] text-white";

export function WzTag({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("inline-block whitespace-nowrap", TAG, className)}>{children}</span>;
}

/** "job_id" → "Job Id": Workiz writes a code's words, each capitalised, on its chip. */
export function shortCodeLabel(code: string): string {
  return code
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The short codes under one of the Texting tab's "Text templates" boxes
 * (`tag short_code`): 14px/16px 500 white chips on #61747d, 3px corners,
 * 1px 4px in, 4px apart in both directions. A click puts `{{code}}` in the
 * box at its caret (the caller's `onInsert`).
 */
export function WzShortCodeChips({
  label,
  codes,
  onInsert,
  disabled,
  className,
}: {
  /** The group's accessible name ("Short codes for On the Way"). */
  label: string;
  codes: readonly string[];
  onInsert: (code: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap gap-1", className)}>
      {codes.map((code) => (
        <button
          key={code}
          type="button"
          disabled={disabled}
          title={`{{${code}}}`}
          onClick={() => onInsert(`{{${code}}}`)}
          className={cn(
            TAG,
            "cursor-pointer outline-none hover:bg-foreground focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {shortCodeLabel(code)}
        </button>
      ))}
    </div>
  );
}

/** The 1px #e8e8e8 rule between the Texting tab's sections, 24px above and below. */
export function WzSectionRule({ className }: { className?: string }) {
  // #e8e8e8: Workiz's divider on the Texting tab (pg_settings_phone_wz_texting), a one-off.
  return <div role="separator" className={cn("my-6 h-px w-full bg-[#e8e8e8]", className)} />;
}
