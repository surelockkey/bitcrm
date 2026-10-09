"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/*
 * Workiz's settings pages, measured off uikit_wz_settings_home,
 * uikit_wz_set_jobtypes / _substatus / _servicearea / _taxes and the
 * pg_settings_catalogs_wz_* captures (notes:
 * workiz-data-parser/docs/import/app-parity-2026-10-08/pg_settings_catalogs.md).
 *
 * The settings home is a heading per block over three columns of tiles. A
 * catalog page is full width: a grey band (icon, title, a rule, what the
 * page is for), then "Show:" with the yellow add button, then the grid
 * (`WzLocalGrid pagerInside`, its #f7f7f7 strip with Search and page size).
 * There is no settings rail: Workiz goes back to the home for the next one.
 */

/* ------------------------------------------------------------ Show filter */

export type WzShowFilter = "active" | "disabled" | "all";

/** The "Show:" choices, in Workiz's order (pg_settings_catalogs_wz_jobtypes_show_open). */
export const WZ_SHOW_OPTIONS: readonly { value: WzShowFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "disabled", label: "Disabled" },
  { value: "all", label: "All" },
];

/** The rows "Show:" keeps: the active ones, the rest, or every one. */
export function wzShowRows<T>(
  rows: readonly T[],
  show: WzShowFilter,
  isActive: (row: T) => boolean = (row) => Boolean((row as { active?: boolean }).active),
): T[] {
  if (show === "all") return [...rows];
  const wanted = show === "active";
  return rows.filter((r) => isActive(r) === wanted);
}

/* ------------------------------------------------------------ the band */

/**
 * The band over a settings page (`._explain`): #fafcfc, 30px 10px, 109px; a
 * 30px glyph 40px in, the h2 28px after it (22.4px/26.88px 600 #404040), a
 * 1px #ddd rule 48px tall 40px after the title, the description 30px past
 * the rule (14px/22.4px #404040). Workiz adds "Read guide" (its help site)
 * under the description; we have no guides, so it is left out.
 */
export function WzSettingsHeader({
  icon,
  title,
  description,
  className,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <header
      data-slot="wz-settings-header"
      className={cn("flex min-h-[109px] shrink-0 items-start bg-wz-band px-2.5 py-[30px] text-wz-strong", className)}
    >
      <span
        aria-hidden
        className="ml-[30px] grid h-[27px] w-[30px] shrink-0 place-items-center [&_svg]:size-[27px] [&_svg]:stroke-[1.25]"
      >
        {icon}
      </span>
      <h2 className="ml-[28px] shrink-0 text-[22.4px] leading-[26.88px] font-semibold">{title}</h2>
      {description ? (
        <>
          <span aria-hidden className="mx-10 h-12 w-px shrink-0 bg-wz-frame" />
          <div className="min-w-0 pl-[30px] text-sm leading-[22.4px]">{description}</div>
        </>
      ) : null}
    </header>
  );
}

/* ------------------------------------------------------------ Show + add */

/**
 * The row under the band. With `show`: "Show:" (12.6px/16px 700 #4d4d4d)
 * over the 201×49 select 8px under it, 20px in and 19px down, and the
 * add button at the right edge level with the select's top; 45px to the
 * strip. Without (Sub Status): the button alone at the left, 20px all round.
 */
export function WzSettingsBar({
  show,
  onShowChange,
  action,
  className,
}: {
  show?: WzShowFilter;
  onShowChange?: (show: WzShowFilter) => void;
  /** The yellow "Add New" (a `WzButton size="regular"` with a + icon). */
  action?: ReactNode;
  className?: string;
}) {
  const labelId = useId();
  if (show === undefined) {
    return <div className={cn("flex shrink-0 items-start px-5 py-5", className)}>{action}</div>;
  }
  return (
    <div className={cn("flex shrink-0 items-start justify-between gap-4 px-5 pt-[19px] pb-[45px]", className)}>
      <div className="flex flex-col gap-2">
        {/* #4d4d4d: Workiz's bold form label, a one-off. */}
        <span id={labelId} className="text-[12.6px] leading-4 font-bold text-[#4d4d4d]">
          Show:
        </span>
        <Select value={show} onValueChange={(v) => onShowChange?.(v as WzShowFilter)}>
          <SelectTrigger aria-label="Show" className="h-[49px] w-[201px] pl-[11px] text-base leading-4 text-wz-value">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="w-[201px]">
            {WZ_SHOW_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {action ? <div className="mt-6 shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------ colour */

/**
 * The Color column's swatch (Sub Status `colorCell`): a 100×16 bar with 4px
 * corners — Service Areas draws it the cell's width (`width="full"`). A
 * hex `color`, or a palette `className` (`bg-*`).
 */
export function WzColorBar({
  color,
  className,
  label,
  width = 100,
}: {
  color?: string;
  className?: string;
  label: string;
  width?: 100 | "full";
}) {
  const style: CSSProperties | undefined = color ? { backgroundColor: color } : undefined;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={style}
      className={cn("block h-4 rounded-[4px]", width === "full" ? "w-full" : "mx-auto w-[100px]", className)}
    />
  );
}

/* ------------------------------------------------------------ the home */

/**
 * A block of the settings home: its heading (`h4.grey.underline`, 18px/30px
 * 500 ink over a 1px #ddd rule, 9.9px under the words, 3px in) and its
 * tiles three to a row, 25px apart down and 30px across; 20px from the rule
 * to the tiles, 60px from the last row to the next block.
 */
export function WzSettingsBlock({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("flex flex-col gap-5", className)}>
      <h2 id={headingId} className="mr-[7px] ml-[3px] border-b border-wz-frame pb-[9.9px] text-lg leading-[30px] font-medium text-foreground">
        {title}
      </h2>
      <ul className="grid grid-cols-1 gap-x-[30px] gap-y-[25px] md:grid-cols-2 xl:grid-cols-3">{children}</ul>
    </section>
  );
}

/**
 * A tile of the settings home (`.card.widget.left-green`): 46px, white, a
 * 3px ink rule at the left, 1px corners, Workiz's two-part card shadow, the
 * title 16px/16px 500 ink 15px in, a 25px line glyph 24px from the right.
 * Under the cursor the tile lifts (`.c_hover`: 0 12px 12px -8px
 * rgba(0,0,0,.4), uikit_wz_settings_home_scroll1 "Devices"). Workiz's tile
 * holds only the name; ours keeps its description as the tooltip.
 */
export function WzSettingsTile({ href, title, icon, hint }: { href: string; title: string; icon: ReactNode; hint?: string }) {
  return (
    <li className="min-w-0">
      <Link
        href={href}
        title={hint}
        className="group relative block h-[46px] rounded-[1px] border-l-[3px] border-foreground bg-card p-[15px] pr-14 shadow-[0_1px_3px_rgba(0,0,0,0.16),0_2px_10px_rgba(0,0,0,0.12)] outline-none transition-shadow hover:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.16),0_2px_10px_rgba(0,0,0,0.12)] focus-visible:ring-2 focus-visible:ring-wz-focus"
      >
        <span className="block truncate text-base leading-4 font-medium text-foreground">{title}</span>
        <span
          aria-hidden
          className="absolute top-1/2 right-[23px] grid size-[26px] -translate-y-[calc(50%-2px)] place-items-center text-foreground [&_svg]:size-[25px] [&_svg]:stroke-[1.25]"
        >
          {icon}
        </span>
      </Link>
    </li>
  );
}
