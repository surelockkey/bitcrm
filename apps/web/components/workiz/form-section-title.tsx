"use client";

import { useId, type ReactNode } from "react";
import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Workiz's ⓘ (`wfi-Information-Circle user-module__infoIcon`, the user page):
 * a 24px thin circled "i", 4px after the words it explains, the MUI tooltip
 * on hover or focus. The words also sit in the page, hidden, under `id`, so a
 * control can name them as its description (`aria-describedby`) — a tooltip
 * is not in the page until it opens.
 */
export function WzInfoTip({
  text,
  label,
  id,
  className,
}: {
  text: ReactNode;
  /** What it explains — the button reads "About <label>". */
  label: string;
  id?: string;
  className?: string;
}) {
  const autoId = useId();
  const textId = id ?? `wz-tip-${autoId}`;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`About ${label}`}
            aria-describedby={textId}
            data-slot="wz-info-tip"
            className={cn(
              "ml-1 inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded-full align-middle text-current outline-none focus-visible:ring-2 focus-visible:ring-wz-focus",
              className,
            )}
          >
            <Info className="size-[19px]" strokeWidth={1.25} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{text}</TooltipContent>
      </Tooltip>
      <span id={textId} className="sr-only">
        {text}
      </span>
    </TooltipProvider>
  );
}

/**
 * A block title on the user page (pg_technicians_wz_measure_user.json):
 * "User Details", "Roles and permissions", "Schedule color" — 14px/21px 600
 * ink with 0.4px tracking — and the ones that carry an ⓘ ("Labor cost per
 * hour", "Job types", "Service areas"). Spacing under it is the caller's:
 * Workiz puts 24px under the section titles, 13–37px under the others.
 */
export function WzFormSectionTitle({
  children,
  info,
  level = 3,
  className,
}: {
  children: string;
  /** The ⓘ's words. */
  info?: ReactNode;
  level?: 2 | 3 | 4;
  className?: string;
}) {
  const H = `h${level}` as "h2" | "h3" | "h4";
  return (
    <div data-slot="wz-form-section-title" className={cn("flex items-center", className)}>
      <H className="text-sm leading-[21px] font-semibold tracking-[0.4px] text-foreground">{children}</H>
      {info ? <WzInfoTip text={info} label={children} /> : null}
    </div>
  );
}
