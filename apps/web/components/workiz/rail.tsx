"use client";

import type { ComponentProps, ComponentType, ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * Workiz's right rail — the job page's Timeline / Notes / Calls / Messages
 * strip (job_b_03_rail*, jobshell notes) and the client page's Notes /
 * History / Files (uikit_wz_client_page). Lifted from the job page's
 * deal-timeline-panel.tsx so both pages draw the same chrome.
 */

/**
 * The collapsed strip: 55px, white, a soft left shadow; a 62px #f7f7f7 cap
 * with "←" when it can expand; the buttons below.
 */
export function WzRail({
  onExpand,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { "aria-label": string; onExpand?: () => void }) {
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      data-slot="wz-rail"
      className={cn("flex w-[55px] shrink-0 flex-col items-center bg-white shadow-[-3px_0_8px_rgba(0,0,0,0.12)]", className)}
      {...props}
    >
      {onExpand ? (
        <div className="flex h-[62px] w-full justify-center bg-muted pt-2.5">
          <button
            type="button"
            aria-label="Expand panel"
            title="Expand"
            onClick={onExpand}
            className="grid h-8 w-[21px] place-items-center rounded-[8px] text-foreground hover:bg-white"
          >
            <ArrowLeft className="size-5" strokeWidth={1.25} />
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * One rail icon: a 32px IconButton (8px corners, #f3f6f7 hovered), the glyph
 * 22px at a 1.25 stroke; a count rides its top right on a 20px #f45e44 disc
 * (11px/500 white). `caption` puts the label under the icon in 11px ink, as
 * the client page's rail does (IconButton-module largeWithTitle, 54px).
 */
export function WzRailButton({
  icon: Icon,
  label,
  badge,
  caption = false,
  expanded,
  className,
  onClick,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  badge?: ReactNode;
  caption?: boolean;
  expanded?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={badge ? `${label} (${badge})` : label}
      aria-expanded={expanded}
      title={label}
      onClick={onClick}
      className={cn(
        "relative grid place-items-center rounded-[8px] text-foreground outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-ring/50",
        caption ? "h-[54px] w-[54px] content-end gap-1 pb-2" : "size-8",
        className,
      )}
    >
      <Icon className="size-[22px]" strokeWidth={1.25} />
      {caption ? <span className="text-[11px] leading-none text-foreground">{label}</span> : null}
      {badge ? (
        // A disc at one digit, a lozenge at "99+" (rounded-pill).
        <span className="absolute -top-3.5 left-[13px] grid h-5 min-w-5 place-items-center rounded-pill bg-wz-danger px-1 text-[11px] leading-5 font-medium text-white tabular-nums">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The open panel: 350px in the page's flow (it narrows the content, as
 * Workiz's does; on a phone it floats over the page), a 62px #f7f7f7 head
 * with "→" to close and the 18px/600 title centred, then the body, which
 * scrolls.
 */
export function WzRailPanel({
  title,
  onClose,
  className,
  bodyClassName,
  children,
  ...props
}: Omit<ComponentProps<"aside">, "title"> & {
  "aria-label": string;
  title: ReactNode;
  onClose: () => void;
  bodyClassName?: string;
}) {
  return (
    <aside
      data-slot="wz-rail-panel"
      className={cn(
        "flex w-[350px] max-w-[85vw] shrink-0 flex-col overflow-hidden bg-white shadow-[-3px_0_8px_rgba(0,0,0,0.12)] max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40",
        className,
      )}
      {...props}
    >
      <div className="relative flex h-[62px] shrink-0 items-start bg-muted px-5 pt-2.5">
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="relative z-10 grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-white"
        >
          <ArrowRight className="size-5" strokeWidth={1.25} />
        </button>
        <h2 className="pointer-events-none absolute inset-x-0 top-3 pl-4 text-center text-[18px] leading-8 font-semibold text-foreground">
          {title}
        </h2>
      </div>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
    </aside>
  );
}
