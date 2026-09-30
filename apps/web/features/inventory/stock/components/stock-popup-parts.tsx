"use client";

import { ChevronLeft, ChevronRight, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHead, TableHeader, TableRow, TableBody } from "@/components/ui/table";
import { usePageSize } from "@/lib/paging/use-page-size";
import { TableFrame } from "@/features/inventory/components/table-frame";
import { SkeletonRows } from "@/features/inventory/components/inventory-table";
import type { pageSlice } from "../lib";

/**
 * The pieces both stock popups are built from — an item's (rows are
 * locations) and a location's (rows are items) — so the two read as one.
 */

/** Workiz pages its stock popups ten at a time, offering 10 / 25 / 50. */
export const PAGE_SIZES = [10, 25, 50] as const;

/** Rows per page in the stock popups — remembered between visits, like every list's. */
export function usePopupPageSize(): [number, (size: number) => void] {
  return usePageSize("stock-popup", { sizes: PAGE_SIZES, fallback: PAGE_SIZES[0] });
}

/**
 * The stock popups' frame: a fixed height, not a maximum. A centred popup
 * that grows moves both its edges — on load, on every search keystroke, on a
 * short last page. At a fixed height only the body scrolls.
 */
export const STOCK_POPUP = "flex h-[min(56rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0";

/** A popup table's height for `rows` rows: the 40px header and 49px rows. */
export function tableHeight(rows: number): string {
  return `${40 + Math.max(1, rows) * 49}px`;
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div role="group" aria-label={label} className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Search on the left, rows per page on the right — the top of the grey panel. */
export function PanelToolbar({
  search,
  onSearch,
  searchLabel,
  size,
  onSize,
  disabled = false,
}: {
  search: string;
  onSearch: (term: string) => void;
  searchLabel: string;
  size: number;
  onSize: (size: number) => void;
  /** Loading: the controls are in place, nothing to search yet. */
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="relative w-full sm:max-w-xs">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label={searchLabel}
          placeholder="Search"
          value={search}
          disabled={disabled}
          onChange={(e) => onSearch(e.target.value)}
          className="h-9 bg-background pl-8"
        />
      </div>
      <Select value={String(size)} onValueChange={(v) => onSize(Number(v))}>
        <SelectTrigger className="h-9 w-20 bg-background" aria-label="Rows per page">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Workiz's footer: "Showing 1 to 10 of 93 results" and "‹ Page 1 of 10 ›". */
export function PanelPager({
  view,
  onPage,
}: {
  view: ReturnType<typeof pageSlice>;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span className="tabular-nums">
        Showing {view.from} to {view.to} of {view.total} results
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous page"
          disabled={view.page <= 1}
          onClick={() => onPage(view.page - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="px-1 whitespace-nowrap">
          Page {view.page} of {view.pages}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next page"
          disabled={view.page >= view.pages}
          onClick={() => onPage(view.page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/**
 * The popup as it will look, before the stock is in: the cards, the toolbar,
 * a page of placeholder rows under the real headers, and the pager's line —
 * so nothing moves when the rows land.
 */
export function PanelLoading({
  testId,
  cards,
  searchLabel,
  headers,
  size,
  onSize,
}: {
  testId: string;
  cards: number;
  searchLabel: string;
  headers: string[];
  size: number;
  onSize: (size: number) => void;
}) {
  return (
    <div data-testid={testId} aria-busy="true" className="space-y-4">
      <div className={cards === 3 ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-[4.5rem] w-full" />
        ))}
      </div>
      <div className="space-y-3 rounded-lg bg-muted/60 p-3">
        <PanelToolbar search="" onSearch={() => {}} searchLabel={searchLabel} size={size} onSize={onSize} disabled />
        <TableFrame className="bg-background" style={{ minHeight: tableHeight(size) }}>
          <Table contained={false} className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {headers.map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <SkeletonRows columns={headers.length} rows={size} />
            </TableBody>
          </Table>
        </TableFrame>
        <div data-testid="panel-pager-placeholder" className="flex min-h-8 items-center justify-between gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  );
}

export function PanelError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="font-medium">Couldn&apos;t load stock</div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
