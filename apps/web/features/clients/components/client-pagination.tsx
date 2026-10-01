"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const CLIENT_PAGE_SIZES = [10, 25, 50, 100] as const;

/**
 * Workiz's footer under a client-card table: "Showing 1 to 10 of 753 results",
 * then ‹ Page 1 of 76 › — arrows only, no page numbers. The rows are all in
 * hand, so the count is exact.
 */
export function ClientPagination({
  page,
  pages,
  total,
  size,
  onPage,
  onSize,
}: {
  page: number;
  pages: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <div data-testid="client-pagination" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground">
      <span className="tabular-nums">
        Showing {from.toLocaleString()} to {to.toLocaleString()} of {total.toLocaleString()} results
      </span>
      <div className="flex items-center gap-2">
        <Select value={String(size)} onValueChange={(v) => onSize(Number(v))}>
          <SelectTrigger className="h-8 w-20" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLIENT_PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-24 text-center tabular-nums">
          Page {page.toLocaleString()} of {pages.toLocaleString()}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
