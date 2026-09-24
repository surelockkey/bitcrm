"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PAGE_SIZES } from "@/lib/paging/use-page-size";
import type { Pager } from "@/lib/paging/use-pager";
import { cn } from "@/lib/utils";

/**
 * Панель під списком: що зараз видно, куди перейти, по скільки вантажити.
 *
 * Номери — рівно ті сторінки, куди можна потрапити: пройдені (вони в руках,
 * тому миттєві) і наступна за курсором. Списки живуть у DynamoDB, де сьомої
 * сторінки без шести попередніх не буває, і показувати номер, який нічого не
 * відкриє, — гірше, ніж не показувати.
 */
export function ListPagination<T>({
  pager,
  size,
  onSizeChange,
  className,
}: {
  pager: Pager<T>;
  size: number;
  onSizeChange: (size: number) => void;
  className?: string;
}) {
  // Перше завантаження: нема ще ні рядків, ні чисел — скелет таблиці говорить
  // сам за себе, а панель під ним блимала б порожніми дужками.
  if (pager.isLoading && !pager.items.length) return null;

  const range = pager.from ? `${pager.from.toLocaleString()}–${pager.to.toLocaleString()}` : "0";
  const many = pager.window.length > 1;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-t px-1 py-3 text-xs text-muted-foreground",
        className,
      )}
    >
      <span>
        Showing {range}
        {pager.total === undefined
          ? ""
          : ` of ${pager.total.toLocaleString()}${pager.totalIsFloor ? "+" : ""}`}
      </span>

      {many ? (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={!pager.canPrev}
            onClick={() => pager.prev()}
          >
            <ChevronLeft />
          </Button>
          {pager.window.map((n, i) =>
            n === "…" ? (
              // Проміжок, а не кнопка: туди не перейти, поки не пройдено все до нього.
              <span key={`gap-${i}`} className="px-1 select-none">
                …
              </span>
            ) : (
              <Button
                key={n}
                variant={n === pager.page ? "outline" : "ghost"}
                size="sm"
                aria-label={`Page ${n}`}
                aria-current={n === pager.page ? "page" : undefined}
                disabled={pager.isFetching && n !== pager.page}
                onClick={() => void pager.goto(n)}
              >
                {n}
              </Button>
            ),
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={!pager.canNext || pager.isFetching}
            onClick={() => void pager.next()}
          >
            <ChevronRight />
          </Button>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <span id="rows-per-page-label">Rows per page</span>
        <Select value={String(size)} onValueChange={(v) => onSizeChange(Number(v))}>
          <SelectTrigger size="sm" className="w-[4.5rem]" aria-labelledby="rows-per-page-label">
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
    </div>
  );
}
