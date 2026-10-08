"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WzPager } from "@/components/workiz/pager";
import { PAGE_SIZES } from "@/lib/paging/use-page-size";
import type { Pager } from "@/lib/paging/use-pager";

/**
 * Панель під списком: що зараз видно, куди перейти, по скільки вантажити.
 *
 * Виглядає як підвал списку Workiz (list_07_bottom, `WzPager`): «Showing 1
 * to 50 of 208 results» ліворуч, ‹ «Page 1 of 5» › посередині. Номерів
 * сторінок немає ні у Workiz, ні тут: списки живуть у DynamoDB, де сьомої
 * сторінки без шести попередніх не буває. Вибір «Rows per page» лишається
 * праворуч (у Workiz він у смузі над таблицею, якої наші сторінки не мають),
 * у вигляді їхнього поля розміру сторінки: 75×34, #f7f7f7, рамка #ccc.
 */
export function ListPagination<T>({
  pager,
  size,
  onSizeChange,
  className,
  reserveSpace = false,
}: {
  pager: Pager<T>;
  size: number;
  onSizeChange: (size: number) => void;
  className?: string;
  /**
   * Keep the bar, at its own height, while the first page loads — for a
   * table whose skeleton already has the final size, so nothing under it
   * moves when the rows land.
   */
  reserveSpace?: boolean;
}) {
  // Перше завантаження: нема ще ні рядків, ні чисел. Без `reserveSpace` панель
  // стоїть осторонь — скелет таблиці говорить сам за себе.
  const first = pager.isLoading && !pager.items.length;
  if (first && !reserveSpace) return null;

  return (
    <WzPager
      pager={pager}
      loading={first}
      // ‹ › only when there is somewhere to go.
      nav={pager.canPrev || pager.canNext || pager.window.length > 1}
      className={className}
      end={
        <>
          <span id="rows-per-page-label">Rows per page</span>
          <Select value={String(size)} onValueChange={(v) => onSizeChange(Number(v))}>
            <SelectTrigger
              size="sm"
              className="h-[34px] w-[75px] rounded-chip bg-muted data-[size=sm]:h-[34px] text-[13.86px] font-medium tracking-[0.5px] text-[#444444]"
              aria-labelledby="rows-per-page-label"
            >
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
        </>
      }
    />
  );
}
