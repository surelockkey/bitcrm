"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface WzTab {
  value: string;
  label: string;
  /** A grey counter after the name (small tabs): "Jobs 1", "Estimates 0". */
  count?: ReactNode;
  /** The 12px line under the name (job tabs): "$0.00 balance", "3 attachments". */
  sublabel?: ReactNode;
  /** The tab element's id, for a tabpanel's `aria-labelledby`. */
  id?: string;
  disabled?: boolean;
}

/**
 * Workiz's tab rows, one per `variant`:
 *
 * - `small` (default) — the client page, Custom fields, the jobs list status
 *   tabs (Tabs-module; list_01_submitted, uikit_wz_client_page): 13px/19px
 *   words 20px apart, slate #566d76 (500) at rest, ink 600 when open; a 20px
 *   #dfe2e3 counter (11px/600 ink) after the name. The 1px #c4c4c4 rule is
 *   the row's own last pixel row (43px from the row's top to the strip under
 *   it, with the 20px counters), and the open tab's 2px ink bar covers it
 *   (audit_pixels L19) — an inset shadow, not a border under the row.
 * - `page` — the big Price book tabs (`_tabs`): a 1px #ccc rule, 16px/500
 *   #404040 words, 15px 25px; 600 when open over a 3px #3e4b51 bar.
 * - `job` — the job page's tab bar (job_b_01_details): Workiz's nine tabs
 *   share the bar, so each is a ninth of it (149px on a 1345px column) —
 *   ours, fewer, keep that width and sit from the left, so each name lands
 *   where Workiz's does; a 16px/500 name over a 12px grey line, never cut
 *   to "…" (with the Timeline open a tab grows to its text plus 18px a
 *   side, as Workiz's do — rail_chat); the open one carries a 4px #3e4b51 bar
 *   along its foot, drawn over the 1px #cad3d6 rule that closes the grey
 *   band — 89px in all (audit_pixels J7: Workiz's bar 389–392 over the rule
 *   at 392).
 * - `legacy` — the legacy reports' `standard-tabs` (Job Statistics,
 *   rep_jobstats_wz_02_overview_day): no rule of its own (the content box
 *   under it has one), 16px/500 ink words open or not, 15px 45px, the open
 *   one a 4px #3e4b51 bar — pull the row 1px over the box (`-mb-px`) so the
 *   bar covers its top edge, as Workiz draws it.
 *
 * Tabs, not buttons: one Tab stop (the open tab, else the first), the arrow
 * keys / Home / End move between them and open the one they land on
 * (audit_dispatcher: the job tabs did not answer the arrow keys).
 */
export function WzTabBar({
  tabs,
  value,
  onValueChange,
  variant = "small",
  className,
  "aria-label": ariaLabel,
}: {
  tabs: readonly WzTab[];
  value: string;
  onValueChange: (value: string) => void;
  variant?: "small" | "page" | "job" | "legacy";
  className?: string;
  "aria-label": string;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // With no tab open (the jobs list under a "status: Done" chip), the first
  // enabled tab keeps the row in the Tab order.
  const stop = tabs.some((t) => t.value === value) ? value : tabs.find((t) => !t.disabled)?.value;

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!enabled.length) return;
    // From the tab that has the focus (the open one, until the keys move it).
    const focused = refs.current.indexOf(e.target as HTMLButtonElement);
    const at = enabled.indexOf(focused >= 0 ? focused : tabs.findIndex((t) => t.value === value));
    let next: number | undefined;
    if (e.key === "ArrowRight") next = enabled[(at + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onValueChange(tabs[next].value);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-slot="wz-tab-bar"
      data-variant={variant}
      onKeyDown={move}
      className={cn(
        "flex overflow-x-auto",
        variant === "small" && "shadow-[inset_0_-1px_0_var(--wz-tab-rule)]",
        variant === "page" && "border-b border-input",
        variant === "job" && "h-[89px] shadow-[inset_0_-1px_0_var(--wz-rule)]",
        className,
      )}
    >
      {tabs.map((t, i) => {
        const open = t.value === value;
        // The grey line's id follows the tab's own ("job-tab-details-sub").
        const sub = t.id ? `${t.id}-sub` : `${id}-${i}-sub`;
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={t.id}
            aria-selected={open}
            tabIndex={t.value === stop ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onValueChange(t.value)}
            {...(variant === "job" ? { "aria-label": t.label, "aria-describedby": sub } : {})}
            className={cn(
              "relative outline-none focus-visible:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-50",
              variant === "small" && [
                "flex shrink-0 items-center gap-2 px-5 pt-2.5 pb-[9px] text-[13px] leading-[19px] tracking-[0.4px] whitespace-nowrap",
                open ? "font-semibold text-foreground" : "font-medium text-wz-slate hover:text-foreground",
              ],
              variant === "page" && [
                "flex shrink-0 items-center px-[25px] py-[15px] text-base leading-4 whitespace-nowrap text-wz-strong",
                open ? "font-semibold" : "font-medium",
              ],
              variant === "job" && "flex w-[calc(100%/9)] min-w-max shrink-0 flex-col items-center px-[18px] pt-4 text-center",
              variant === "legacy" &&
                "flex shrink-0 items-center px-[45px] py-[15px] text-base leading-4 font-medium tracking-[0.5px] whitespace-nowrap text-foreground",
            )}
          >
            {variant === "job" ? (
              <>
                <span className="text-[16px] leading-4 font-medium text-wz-strong">{t.label}</span>
                <span id={sub} className="mt-2 text-[12px] leading-4 whitespace-nowrap text-wz-strong">
                  {t.sublabel}
                </span>
              </>
            ) : (
              <>
                {t.label}
                {/* A space between the name and its counter, for the tab's name
                    ("Jobs 18", not "Jobs18"); a flex row draws none. */}
                {t.count !== undefined && t.count !== null ? " " : null}
                {t.count !== undefined && t.count !== null ? (
                  <span
                    data-slot="wz-tab-count"
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-border px-1.5 text-[11px] leading-4 font-semibold text-foreground tabular-nums"
                  >
                    {t.count}
                  </span>
                ) : null}
              </>
            )}
            {open ? (
              <span
                aria-hidden
                data-slot="wz-tab-bar-line"
                className={cn(
                  "absolute inset-x-0",
                  variant === "small" && "bottom-0 h-0.5 bg-foreground",
                  variant === "page" && "bottom-0 h-[3px] bg-wz-tab-bar",
                  variant === "job" && "bottom-0 h-1 bg-wz-tab-bar",
                  variant === "legacy" && "bottom-0 h-1 bg-wz-tab-bar",
                )}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
