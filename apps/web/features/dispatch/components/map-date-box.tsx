"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MAP_RANGES, mapRangeLabel, type MapRange } from "../map-range";

/** Workiz's `wfi-marked`: a calendar with a dot on today. */
function CalendarDotIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden focusable="false">
      <rect x="3.2" y="4.6" width="17.6" height="16" rx="1.4" />
      <path d="M3.2 9.4h17.6M8 2.8v3.6M16 2.8v3.6" />
      <circle cx="8.2" cy="14.6" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** An IconButton (32×32, 8px corners, #f3f6f7 hovered) with Workiz's tooltip 14px under it. */
function BoxButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} className="[&_svg:not([class*='size-'])]:size-5">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={14}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The date box over the map (Map-module dateFilterContainer, pg_dispatch_wz_02
 * / _07 / _14): white, 8px corners, 12px in, centred 15px under the map's
 * top, at most 560px inside. "Day | Week | Month" in a 110×38 select, the
 * days in 14px/21px semibold #404040 in the middle, then ‹ › and "Reset date".
 */
export function MapDateBox({
  range,
  anchor,
  onRange,
  onStep,
  onReset,
}: {
  range: MapRange;
  anchor: string;
  onRange: (range: MapRange) => void;
  onStep: (step: 1 | -1) => void;
  onReset: () => void;
}) {
  return (
    <TooltipProvider>
      <div className="absolute inset-x-0 top-[15px] z-10 mx-auto grid max-w-[584px] grid-cols-[1fr_3fr_1fr] items-center rounded-[8px] bg-white p-3 tracking-[0.4px]">
        <Select value={range} onValueChange={(v) => onRange(v as MapRange)}>
          <SelectTrigger aria-label="Range" className="h-[38px] w-[110px] text-wz-value">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MAP_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="text-center text-sm leading-[21px] font-semibold text-wz-strong">
          {mapRangeLabel(range, anchor).map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
        <div className="flex justify-end gap-3">
          <BoxButton label="Previous" onClick={() => onStep(-1)}>
            <ChevronLeft strokeWidth={1.6} />
          </BoxButton>
          <BoxButton label="Next" onClick={() => onStep(1)}>
            <ChevronRight strokeWidth={1.6} />
          </BoxButton>
          <BoxButton label="Reset date" onClick={onReset}>
            <CalendarDotIcon />
          </BoxButton>
        </div>
      </div>
    </TooltipProvider>
  );
}
