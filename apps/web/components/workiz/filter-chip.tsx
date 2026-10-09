"use client";

import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A picked value inside Workiz's "Filter results" / "Show:" selects
 * (react-select multi-value; jobslist_wz_filter_three, uikit_wz_pricebook
 * "status: Active items"): a 26px white frame (1px #ccc, 2px corner) round a
 * block in the value's own colour (3px corner) holding the 11.9px/500 label,
 * then a 23px × segment behind a #ccc rule. Workiz's × is a small bold glyph
 * (audit_pixels L7). Uncoloured values are grey with dark words.
 */
export function WzFilterChip({
  label,
  colorClassName,
  tone,
  onRemove,
  className,
}: {
  label: string;
  /** The value's colour as a background class (a tech's, a tag's); none → grey. */
  colorClassName?: string | null;
  /** An uncoloured value printed white with #333 words ("status: Active", pg_technicians_wz_01_team). */
  tone?: "white";
  onRemove: () => void;
  className?: string;
}) {
  return (
    <span
      data-slot="wz-filter-chip"
      onMouseDown={(e) => e.stopPropagation()}
      className={cn("inline-flex h-[26px] max-w-[22rem] items-stretch rounded-chip border border-input bg-background p-px", className)}
    >
      <span
        className={cn(
          "flex min-w-0 items-stretch overflow-hidden rounded-[3px]",
          colorClassName
            ? [colorClassName, "text-white"]
            : tone === "white"
              ? "bg-background text-wz-value"
              : "bg-wz-disabled-border text-wz-value",
        )}
      >
        <span className={cn("truncate py-[3px] pr-[3px] pl-1.5 text-[11.9px] leading-4", tone === "white" && !colorClassName ? "font-normal" : "font-medium")}>
          {label}
        </span>
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          className="grid w-[23px] shrink-0 place-items-center border-l border-input hover:brightness-90"
        >
          <X className="size-2.5" strokeWidth={3.5} />
        </button>
      </span>
    </span>
  );
}
