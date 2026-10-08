"use client";

import type { ComponentProps } from "react";
import { ChevronDown, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The strip above every Workiz grid (`.columns.tableFilters`, list_01 /
 * uikit_wz_estimates / uikit_wz_pricebook): #f7f7f7 under a 1px #ddd rule,
 * 71px, the Search box at the left and the page size / Export / Fields at
 * the right (`ml-auto` on that group).
 */
export function WzListToolbar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="wz-list-toolbar"
      className={cn(
        "flex min-h-[71px] flex-wrap items-center gap-x-[18px] gap-y-2 border-t border-wz-frame bg-muted px-[21px] py-[15px]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Workiz's table Search (Input-module, list_01: 348×40, 1px #9ea6aa, 4px
 * corner, 13px ink between 44px sides, a magnifier at the left; the edge
 * turns #6aa8ee while focused; a round × on #f3f6f7 once there is text).
 */
export function WzSearchBox({
  value,
  onChange,
  placeholder = "Search",
  "aria-label": ariaLabel = "Search",
  className,
  ...rest
}: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div data-slot="wz-search-box" className={cn("relative w-[348px] max-w-full", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-foreground" />
      <input
        {...rest}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-[4px] border border-wz-outline bg-background px-11 text-[13px] leading-4 text-foreground outline-none placeholder:text-wz-outline focus:border-wz-link"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-[5px] grid size-[26px] -translate-y-1/2 place-items-center rounded-full bg-wz-secondary-hover text-wz-outline-label hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Workiz's page-size select (`_sajSelectWrap`): a native select in a 75×34
 * box on the grey strip — 1px #ccc, 2px corner, "50 ⌄" at 13.86px/500 #444.
 */
export function WzPageSizeSelect({
  value,
  onChange,
  sizes,
  "aria-label": ariaLabel = "Rows per page",
  className,
}: {
  value: number;
  onChange: (size: number) => void;
  sizes: readonly number[];
  "aria-label"?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative h-[34px] w-[75px] rounded-chip border border-input bg-muted", className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-full w-full cursor-pointer appearance-none bg-transparent pr-7 pl-2.5 text-[13.86px] font-medium tracking-[0.5px] text-[#444444] outline-none"
      >
        {sizes.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-[#444444]" />
    </div>
  );
}

/**
 * The strip's square buttons — "Export", "Fields" (`trnsButton`, 34px, 1px
 * #ccc, 2px corner, 14px #404040). See-through, so the grey strip shows
 * through it as in Workiz (audit_pixels L8).
 */
export function WzToolbarButton({ className, type = "button", ...props }: ComponentProps<"button">) {
  return (
    <button
      type={type}
      data-slot="wz-toolbar-button"
      className={cn(
        "inline-flex h-[34px] shrink-0 items-center gap-1 rounded-chip border border-input bg-transparent px-2.5 text-sm text-wz-strong outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:text-wz-outline [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}
