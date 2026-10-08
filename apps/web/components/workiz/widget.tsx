"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { DropdownMenu as Menu, Tooltip as Tip } from "radix-ui";
import { CircleHelp, EllipsisVertical, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

export interface WzWidgetMenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
}

/**
 * Workiz Home's widget frame (pg_dashboard_wz_home, `styles__frame`): a white
 * 350px card, 8px corners, `0 2px 14px rgba(0,0,0,.04)`, no border.
 *
 * Header (51px, a 1px #ececec rule under it): the title 16px/600 ink, then —
 * only on the widgets Workiz stamps — "updated 3:06 PM" 11px #768287; on the
 * right the 18px #404040 glyphs 24px apart: `?` (only where Workiz explains
 * the widget; a blue MUI tooltip), the mirrored refresh arrows, the kebab
 * (Workiz: "Manage Permissions" / "Remove"). Workiz drops the header's top
 * padding from 20 to 18px when the stamp is there, and so do we.
 *
 * Body: 17px 20px. `viewAll` pins Workiz's "View All" (13px #6aa8ee,
 * underlined except on Sales) 25px in from the left and up from the bottom.
 */
export function WzWidget({
  title,
  updatedAt,
  help,
  onRefresh,
  refreshing = false,
  menu,
  viewAll,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  /** "3:06 PM" — shown as "updated 3:06 PM"; leave out where Workiz shows none. */
  updatedAt?: string;
  /** What the `?` explains; no `?` without it. */
  help?: ReactNode;
  onRefresh?: () => void;
  /** A refetch in flight: the arrows spin and hold still. */
  refreshing?: boolean;
  /** The kebab's items; no kebab without any. */
  menu?: readonly WzWidgetMenuItem[];
  viewAll?: { href: string; label?: string; underline?: boolean };
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-slot="wz-widget"
      className={cn(
        "relative flex h-[350px] min-w-0 flex-col rounded-[8px] bg-white shadow-[0_2px_14px_rgba(0,0,0,0.04)]",
        className,
      )}
    >
      <header
        className={cn(
          "h-[51px] shrink-0 border-b border-wz-dash-rule px-6",
          updatedAt ? "pt-[18px] pb-[2px]" : "pt-5",
        )}
      >
        <div className="flex h-[30px] items-start justify-between gap-2">
          <div className="flex min-w-0 items-baseline">
            <h2 id={headingId} className="mr-2.5 shrink-0 text-base leading-4 font-semibold text-foreground">
              {title}
            </h2>
            {updatedAt ? (
              <small className="truncate text-[11px] leading-[18px] text-wz-outline-label">updated {updatedAt}</small>
            ) : null}
          </div>
          <div className="-mr-[3px] flex h-4 shrink-0 items-center">
            {help ? <WzHelpTip title={title} help={help} /> : null}
            {onRefresh ? (
              <button
                type="button"
                aria-label={`Refresh ${title}`}
                disabled={refreshing}
                onClick={onRefresh}
                className={GLYPH}
              >
                <RefreshCw className={cn("size-[18px] -scale-x-100", refreshing && "animate-spin")} strokeWidth={1.6} />
              </button>
            ) : null}
            {menu?.length ? <WidgetMenu title={title} items={menu} /> : null}
          </div>
        </div>
      </header>
      {/* Workiz's body box is 97.76% of the card, padded 20px: 27px short of the
          right edge on a one-column card, 35px on a two-column one. */}
      <div className={cn("relative min-h-0 flex-1 py-[17px] pr-[calc(20px+2.24%)] pl-5 tracking-[0.075px]", bodyClassName)}>
        {children}
      </div>
      {viewAll ? (
        <Link
          href={viewAll.href}
          className={cn(
            "absolute bottom-[25px] left-[25px] text-[13px] leading-[18px] tracking-[0.075px] text-wz-link hover:text-brand",
            viewAll.underline !== false && "underline",
          )}
        >
          {viewAll.label ?? "View All"}
        </Link>
      ) : null}
    </section>
  );
}

/** An 18px Workiz glyph button: 18.4px wide, 3px either side, #404040. */
const GLYPH =
  "mx-[3px] inline-flex h-[18px] w-[18.4px] cursor-pointer items-center justify-center rounded-sm text-wz-strong outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default";

/**
 * The `?` and its MUI tooltip (pg_dashboard_wz_help_hover): Workiz blue
 * #3589e9, 12px/18px/500 white, 12px in, 4px corners, a soft two-part
 * shadow, an arrow, above the glyph.
 */
function WzHelpTip({ title, help }: { title: string; help: ReactNode }) {
  return (
    <Tip.Provider delayDuration={0}>
      <Tip.Root>
        <Tip.Trigger asChild>
          <button type="button" aria-label={`About ${title}`} className={GLYPH}>
            <CircleHelp className="size-[18px]" strokeWidth={1.6} />
          </button>
        </Tip.Trigger>
        <Tip.Portal>
          <Tip.Content
            side="top"
            sideOffset={6}
            data-slot="wz-help-tip"
            className="z-50 max-w-[264px] rounded-[4px] bg-brand p-3 text-xs leading-[18px] font-medium whitespace-pre-line text-white shadow-[0_0_4px_rgba(59,75,82,0.05),0_4px_12px_rgba(59,75,82,0.1)]"
          >
            {help}
            <Tip.Arrow width={12} height={8} className="fill-brand" />
          </Tip.Content>
        </Tip.Portal>
      </Tip.Root>
    </Tip.Provider>
  );
}

/**
 * The kebab's menu (pg_dashboard_wz_kebab_open): 196px white, 2px corners,
 * `0 2px 10px rgba(0,0,0,.133)`, 22px in, 14px/16px #404040 rows 15px apart,
 * laid over the header from just above the glyph, its right edge 17px past it.
 */
function WidgetMenu({ title, items }: { title: string; items: readonly WzWidgetMenuItem[] }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button type="button" aria-label={`${title} options`} className={GLYPH}>
          <EllipsisVertical className="size-[18px]" strokeWidth={2} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          side="bottom"
          sideOffset={-21}
          alignOffset={-17}
          data-slot="wz-widget-menu"
          className="z-50 flex w-[196px] flex-col gap-[15px] rounded-[2px] bg-white p-[22px] text-sm leading-4 text-wz-strong shadow-[0_2px_10px_rgba(0,0,0,0.133)] outline-none"
        >
          {items.map((item) => (
            <Menu.Item
              key={item.key}
              onSelect={item.onSelect}
              className="cursor-pointer outline-none data-highlighted:text-brand"
            >
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

export interface WzRangeOption<V extends string = string> {
  value: V;
  label: string;
}

/**
 * Workiz's widget range picker (`simpleSelect`, pg_dashboard_wz_range_open):
 * "Last 14 Days" 14px/22px #a0a0a0, capitalised, then a CSS chevron (a 6px
 * corner of 2px #687886 turned 45°, 8.5px across) 7px on. The list hangs right-aligned straight under
 * it: 195px white, 2px corners, `0 5px 6px rgba(0,0,0,.133)`, 42px rows
 * (10px in, the same grey, #fafafa under the pointer).
 */
export function WzRangeSelect<V extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** What the control is, for a screen reader ("Range"). */
  label: string;
  value: V;
  options: readonly WzRangeOption<V>[];
  onChange: (value: V) => void;
  className?: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${current}`}
          className={cn(
            "inline-flex h-[22px] cursor-pointer items-center text-sm leading-[22px] whitespace-nowrap text-wz-dash-label capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {current}
          <i
            aria-hidden
            className="mr-[6px] mb-[3px] ml-2 inline-block size-[6px] rotate-45 border-r-2 border-b-2 border-wz-chevron"
          />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          side="bottom"
          sideOffset={0}
          data-slot="wz-range-menu"
          className="z-50 w-[195px] rounded-[2px] bg-white text-sm leading-[22px] text-wz-dash-label shadow-[0_5px_6px_rgba(0,0,0,0.133)] outline-none"
        >
          <Menu.RadioGroup value={value} onValueChange={(v) => onChange(v as V)}>
            {options.map((o) => (
              <Menu.RadioItem
                key={o.value}
                value={o.value}
                className="h-[42px] cursor-pointer p-2.5 outline-none data-highlighted:bg-wz-disc"
              >
                {o.label}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * A figure in a widget (`dashboard-module__statCard`).
 *
 * `row` — Jobs, Today, Estimates, Leads: a 39px line, the label 14px/21px
 * #666 (with an optional 12px #a0a0a0 line under it, Estimates' "Worth $…")
 * and the figure 28px/32px #6d6d6d on the right; `rule` adds Workiz's 2px
 * coloured edge on the left, 11px from the words.
 *
 * `stacked` — Invoices: "DUE  565 INVOICES" 14px/600 capitals over the
 * amount 28px/42px, 11px in from the rule, 85px tall.
 */
export function WzWidgetStat({
  label,
  value,
  sub,
  rule,
  layout = "row",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** A border-colour utility (`border-wz-stat-green`); no rule without it. */
  rule?: string;
  layout?: "row" | "stacked";
  className?: string;
}) {
  if (layout === "stacked") {
    return (
      <div
        data-slot="wz-widget-stat"
        className={cn("flex h-[85px] flex-col p-[11px]", rule && cn("border-l-2", rule), className)}
      >
        <h3 className="text-sm leading-[21px] font-semibold tracking-[0.167857px] text-wz-text uppercase">
          {label}
          {sub ? <span className="ml-2 text-wz-dash-label">{sub}</span> : null}
        </h3>
        <span className="text-[28px] leading-[42px] tracking-[0.223809px] text-wz-dash-value tabular-nums">{value}</span>
      </div>
    );
  }
  return (
    <div
      data-slot="wz-widget-stat"
      className={cn(
        "flex h-[39px] items-center justify-between gap-3",
        rule && cn("border-l-2 pl-[11px]", rule),
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="truncate text-sm leading-[21px] font-normal tracking-[0.167857px] text-wz-text">{label}</h3>
        {sub ? <div className="truncate text-xs leading-[17px] tracking-[0.167857px] text-wz-dash-label">{sub}</div> : null}
      </div>
      <span className="shrink-0 text-[28px] leading-8 tracking-[0.223809px] text-wz-dash-value tabular-nums">{value}</span>
    </div>
  );
}

/**
 * A chart's legend as Workiz writes it (`dashboard-module__legend`): a 6px
 * dot, 4px, the name (and, on Sales, its total) in 14px/18px #666; items 7px
 * apart, 3px down from the body's top.
 */
export function WzChartLegend({
  items,
  className,
}: {
  /** `color` is a CSS colour — a token's `var(--wz-chart-done)`. */
  items: readonly { label: string; color: string; value?: string }[];
  className?: string;
}) {
  return (
    <ul aria-label="Legend" className={cn("flex min-w-0 flex-wrap gap-x-[7px] pt-[3px] text-sm leading-[18px] text-wz-text", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex h-5 min-w-0 items-center gap-1">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          <span className="truncate">{item.label}</span>
          {/* A flex box drops a bare space from layout but keeps it in the text a reader hears. */}
          {item.value ? (
            <>
              {" "}
              <span className="whitespace-nowrap">{item.value}</span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
