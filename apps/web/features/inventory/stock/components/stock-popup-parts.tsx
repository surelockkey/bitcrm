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
import type { pageSlice } from "../lib";

/**
 * The pieces both stock popups are built from — an item's (rows are
 * locations) and a location's (rows are items) — so the two read as one.
 */

export const PAGE_SIZES = [10, 25, 50] as const;

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
}: {
  search: string;
  onSearch: (term: string) => void;
  searchLabel: string;
  size: number;
  onSize: (size: number) => void;
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
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
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

export function PanelLoading({ testId, cards }: { testId: string; cards: number }) {
  return (
    <div data-testid={testId} className="space-y-4">
      <div className={cards === 3 ? "grid gap-3 sm:grid-cols-3" : "grid gap-3 sm:grid-cols-2"}>
        {Array.from({ length: cards }).map((_, i) => (
          <Skeleton key={i} className="h-[4.5rem] w-full" />
        ))}
      </div>
      <div className="space-y-2 rounded-lg bg-muted/60 p-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
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
