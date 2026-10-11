"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { JobsSort } from "../query-params";

/** The orders the menu offers — the old "Sort jobs" select's, in its words. */
export const SCHEDULED_SORTS: readonly { value: JobsSort; label: string }[] = [
  { value: "none", label: "Day ↑" },
  { value: "day_desc", label: "Day ↓" },
  { value: "hour_asc", label: "Hour ↑" },
  { value: "hour_desc", label: "Hour ↓" },
];

/**
 * Ours, beside Workiz's sortable Scheduled header (Workiz sorts only by the
 * header): a small chevron opening the orders the jobs list had before the
 * Workiz pass — by day either way, or by the time of day across several days
 * (08:00 before 14:00 whatever the date; settled on the rows in hand). The
 * panel is Workiz's legacy `_popMenu`: 175px, 16px corners, its two-part
 * shadow, 37px rows.
 */
export function ScheduledSortMenu({ value, onChange }: { value: JobsSort; onChange: (sort: JobsSort) => void }) {
  // "day_asc" reads as the soonest-first order the list opens in.
  const current = value === "day_asc" ? "none" : value;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Scheduled sort options"
          title="Sort options"
          onClick={(e) => e.stopPropagation()}
          className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[2px] text-[#666] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-wz-focus data-[state=open]:text-foreground"
        >
          <ChevronDown className="size-3.5" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[175px] min-w-0 rounded-[16px] px-0 py-2.5 shadow-[0_3px_6px_rgba(0,0,0,0.18),0_4px_15px_rgba(0,0,0,0.15)]"
      >
        <DropdownMenuRadioGroup value={current} onValueChange={(v) => onChange(v as JobsSort)}>
          {SCHEDULED_SORTS.map((s) => (
            <DropdownMenuRadioItem
              key={s.value}
              value={s.value}
              className="h-[37px] min-h-0 py-0 text-sm leading-[22px] tracking-[0.4px] text-foreground focus:text-foreground"
            >
              {s.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
