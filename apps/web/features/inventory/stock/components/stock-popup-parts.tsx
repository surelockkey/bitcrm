"use client";

import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WZ_GRID_PAGE_SIZES } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { usePageSize } from "@/lib/paging/use-page-size";
import { cn } from "@/lib/utils";
import type { pageSlice } from "../lib";

/**
 * The pieces the stock popups are built from — Workiz's stockModal
 * (pg_inventory_wz_05_stock_popup; main.css stockModal-module, Metrics-module)
 * — so an item's popup (rows are locations) and a location's read as one.
 */

/** Workiz pages its stock popups ten at a time, offering react-table's 5…100. */
export const PAGE_SIZES = WZ_GRID_PAGE_SIZES;

/** Rows per page in the stock popups — remembered between visits, like every list's. */
export function usePopupPageSize(): [number, (size: number) => void] {
  return usePageSize("stock-popup", { sizes: PAGE_SIZES, fallback: 10 });
}

/**
 * Workiz's stockModal: 95% of the window wide, 16px corners, 24px in, white,
 * as tall as it needs up to the window (880px at 1600×1000). A fixed height,
 * not a maximum: a centred popup that grows moves both its edges — on load,
 * on every search keystroke, on a short last page. Only the body scrolls.
 */
export const STOCK_MODAL =
  "flex h-[min(880px,calc(100dvh-2rem))] w-[95vw] max-w-[95vw] flex-col gap-0 overflow-hidden p-6 sm:max-w-[95vw]";

/** A money or count line of a location's popup ("Total Items On Hand: 1538"). */
export function StockMetricCard({ label, value }: { label: string; value: string }) {
  return (
    // Metrics-module in a stockMetricCard: 1px #dfe2e3, 8px corners, 16px in;
    // the label 10px/14px 500 slate capitals 4px over the 25px/32px figure.
    <div role="group" aria-label={label} className="flex flex-col gap-1 rounded-[8px] border border-border bg-background p-4">
      <small className="text-[10px] leading-[14px] font-medium tracking-[0.4px] text-wz-slate uppercase">{label}</small>
      <span className="text-[25px] leading-8 font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

/**
 * The table section: a #fafcfc panel (8px corners, 16px in) holding a white
 * box — its filters strip (Search; the page size at the right) over a 1px
 * #ddd rule, then the table, then react-table's pager.
 */
export function StockTableSection({
  search,
  onSearch,
  searchLabel,
  size,
  onSize,
  disabled = false,
  pager,
  children,
}: {
  search: string;
  onSearch: (term: string) => void;
  searchLabel: string;
  size: number;
  onSize: (size: number) => void;
  /** Loading: the controls are in place, nothing to search yet. */
  disabled?: boolean;
  pager?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-[8px] bg-wz-band p-4">
      <div className="flex min-h-0 flex-col rounded-[4px] bg-background">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-wz-frame bg-wz-band pt-[15px] pb-[29px]">
          <WzSearchBox
            type="search"
            aria-label={searchLabel}
            value={search}
            onChange={onSearch}
            disabled={disabled}
          />
          <WzPageSizeSelect value={size} sizes={PAGE_SIZES} onChange={onSize} className="bg-wz-band" />
        </div>
        {/* react-table's rt-table: 41% of the window at most; the rows scroll under the header. */}
        <div className="max-h-[41vh] min-h-0 overflow-auto">{children}</div>
        {pager}
      </div>
    </div>
  );
}

/** The stock table's header row: 13px/500 ink, 16px in, on #fafcfc, a 1px ink rule under it. */
export const STOCK_TH =
  "sticky top-0 z-[1] border-b border-foreground bg-wz-band p-4 text-left text-[13px] leading-5 font-medium text-foreground";
/** A stock row: 13px ink 16px in, its words on the middle, a #dfe2e3 rule under it, zebra .03, .02 under the cursor. */
export const STOCK_TR = "border-b border-border last:border-b-0 odd:bg-black/[0.03] hover:bg-black/[0.02]";
export const STOCK_TD = "overflow-hidden p-4 align-middle text-[13px] leading-4 text-foreground";

/** The header of a stock table: the column names over the ink rule. */
export function StockTableHead({ columns }: { columns: { label: string; width?: string }[] }) {
  return (
    <>
      <colgroup>
        {columns.map((c) => (
          <col key={c.label} className={c.width} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.label} scope="col" className={STOCK_TH}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
    </>
  );
}

/** Workiz's footer under the rows: "Showing 1 to 10 of 94 results" ‹ "Page 1 of 10" ›. */
export function StockPager({ view, onPage }: { view: ReturnType<typeof pageSlice>; onPage: (page: number) => void }) {
  return (
    <WzPager
      plainNumbers
      className="shrink-0 bg-background"
      pager={{
        page: view.page,
        from: view.from,
        to: view.to,
        total: view.total,
        totalPages: view.pages,
        canPrev: view.page > 1,
        canNext: view.page < view.pages,
        isFetching: false,
        prev: () => onPage(view.page - 1),
        next: () => onPage(view.page + 1),
      }}
    />
  );
}

/**
 * The section while the stock is on its way: the controls in place, the
 * table's header over Workiz's three dots, the pager's place — nothing moves
 * when the rows land.
 */
export function StockSectionLoading({
  testId,
  searchLabel,
  headers,
  size,
  onSize,
}: {
  testId: string;
  searchLabel: string;
  headers: { label: string; width?: string }[];
  size: number;
  onSize: (size: number) => void;
}) {
  return (
    <div data-testid={testId} aria-busy="true" className="contents">
      <StockTableSection search="" onSearch={() => {}} searchLabel={searchLabel} size={size} onSize={onSize} disabled>
        <div className="relative">
          <table className="w-full table-fixed border-collapse">
            <StockTableHead columns={headers} />
          </table>
          <div role="status" aria-label="Loading" className="flex h-[228px] items-center justify-center gap-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-[13px] animate-pulse rounded-full bg-foreground"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </div>
        </div>
      </StockTableSection>
    </div>
  );
}

export function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[8px] bg-wz-band py-16 text-center">
      <TriangleAlert className="size-6 text-wz-danger" />
      <div className="text-sm font-medium">Couldn&apos;t load stock</div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** A row the table has nothing for: react-table's note, #9ea6aa on white, 20px in. */
export function StockNoRows({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={columns} className={cn(STOCK_TD, "py-5 text-center text-wz-outline")}>
        {children}
      </td>
    </tr>
  );
}
