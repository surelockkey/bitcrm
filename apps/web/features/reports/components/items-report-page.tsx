"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { ITEMS_REPORT_ITEM_TYPES, type ItemsReportFilters, type ItemsReportPage as ItemsPage, type ItemsReportSort } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTimeRangePicker } from "@/components/ui/date-time-range-picker";
import { DAY_END, DAY_START, toIsoInstant, toLocalParts } from "@/lib/date-range";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useJobTypes } from "@/features/job-types/hooks";
import { accountToday } from "../jobs/lib";
import { downloadItemsReportCsv } from "../items/api";
import { useItemsReport } from "../items/hooks";
import {
  DEFAULT_ITEMS_PRESET,
  ITEMS_REPORT_PAGE_SIZES,
  ITEMS_REPORT_PRESETS,
  itemsExportParams,
  itemsPresetRange,
  itemsReportParams,
  nextSort,
  type ItemsReportPreset,
  type ItemsReportState,
} from "../items/lib";
import { ItemsReportFilter, type ItemsFilterGroup } from "../items/components/items-report-filter";
import { ItemsReportTable } from "../items/components/items-report-table";

/**
 * The Workiz Items and services report (`/root/itemsReport`): every
 * price-book item the period's Done jobs sold — units, price, cost, profit
 * with its margin, jobs — under a bold Total row; ▸ opens the jobs that
 * used an item. Workiz's four-group filter (Item type, Job type, Category,
 * Sold by), its date presets (This month by default, Last 3 months), a
 * search, a sort on every column, 50 rows a page and a CSV. The server does
 * the work (`GET /deals/report/items`); this page only holds the toolbar.
 */
export function ItemsReportPage({ today: todayProp }: { today?: string } = {}) {
  const denied = useDenied();
  const { can } = usePermissions();
  // The presets count from today on the account's calendar (Eastern), not the viewer's.
  const [today] = useState(() => todayProp ?? accountToday());

  const [preset, setPreset] = useState<ItemsReportPreset>(DEFAULT_ITEMS_PRESET);
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: today, to: today });
  const range = preset === "custom" ? custom : itemsPresetRange(preset, today);
  const [filters, setFilters] = useState<ItemsReportFilters>({});
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 400);
  // Workiz opens on `item_id desc`: the newest items first.
  const [sort, setSort] = useState<{ column: ItemsReportSort; dir: "asc" | "desc" }>({ column: "number", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);

  const state: ItemsReportState = { from: range.from, to: range.to, filters, search: q, sort: sort.column, dir: sort.dir, page, pageSize };
  const report = useItemsReport(itemsReportParams(state), !denied("reports", "view"));
  const data = report.data;
  const money = data?.money ?? can("financials");
  const groups = useFilterGroups(data);

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const changeFilters = resetPage(setFilters);

  const onSort = (column: ItemsReportSort) => {
    setSort((cur) => nextSort(cur, column));
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await downloadItemsReportCsv(itemsExportParams(state));
      if (typeof URL.createObjectURL !== "function") return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `items-report-${state.from}_${state.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const pagination = data?.pagination;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">Items and services</h1>
      </div>

      {/* Workiz's top band: the multi-filter, and the period box. */}
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:px-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <ItemsReportFilter groups={groups} filters={filters} onChange={changeFilters} />
        </div>
        <div className="flex w-full flex-col gap-2 rounded-md border p-2 lg:w-[22rem]">
          <select
            aria-label="Date preset"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={preset}
            onChange={(e) => resetPage(setPreset)(e.target.value as ItemsReportPreset)}
          >
            {ITEMS_REPORT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <DateTimeRangePicker
            dateOnly
            label="Days"
            value={{ from: toIsoInstant(range.from, DAY_START), to: toIsoInstant(range.to, DAY_END) }}
            onChange={(r) => {
              const from = toLocalParts(r.from)?.date ?? range.from;
              const to = toLocalParts(r.to)?.date ?? from;
              setCustom({ from, to });
              setPreset("custom");
              setPage(1);
            }}
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 bg-muted/30 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search"
              className="h-9 bg-background pl-8"
              placeholder="Search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <span className="flex-1" />
          <select
            aria-label="Rows per page"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={pageSize}
            onChange={(e) => resetPage(setPageSize)(Number(e.target.value))}
          >
            {ITEMS_REPORT_PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-background" onClick={() => void exportCsv()} disabled={exporting || !data}>
            <Download className="size-3.5" /> {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>

        {report.error ? (
          <p role="alert" className="text-sm text-destructive">
            {report.error instanceof Error ? report.error.message : "Could not load the report."}
          </p>
        ) : !data ? (
          <div role="status" aria-label="Loading items" className="space-y-2">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            <ItemsReportTable
              // A new period or filter closes every opened item.
              key={`${state.from}|${state.to}|${JSON.stringify(filters)}|${q}`}
              rows={data.rows}
              totals={data.totals}
              money={money}
              sort={data.sort.column}
              dir={data.sort.dir}
              onSort={onSort}
              state={state}
              busy={report.isFetching}
            />
            {pagination ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {pagination.total === 0
                    ? "No results"
                    : `Showing ${pagination.from.toLocaleString()} to ${pagination.to.toLocaleString()} of ${pagination.total.toLocaleString()} results`}
                </span>
                <Pager page={pagination.page} pages={pagination.pages} onPage={setPage} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** Previous / a window of page numbers / Next. */
function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const first = Math.max(1, Math.min(page - 2, pages - 4));
  const numbers = Array.from({ length: Math.min(5, pages) }, (_, i) => first + i);
  return (
    <nav aria-label="Pages" className="flex items-center gap-1">
      <Button variant="outline" size="icon" className="size-8" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="size-4" />
      </Button>
      {numbers.map((n) => (
        <Button
          key={n}
          variant={n === page ? "default" : "ghost"}
          size="sm"
          className="h-8 min-w-8 px-2 tabular-nums"
          aria-current={n === page ? "page" : undefined}
          onClick={() => onPage(n)}
        >
          {n}
        </Button>
      ))}
      <Button variant="outline" size="icon" className="size-8" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight className="size-4" />
      </Button>
    </nav>
  );
}

/**
 * The filter's groups, in Workiz's order: the six item types, every job
 * type, and — as only the period knows them — its categories and sellers.
 * The last page's options are kept while the next loads, so a group does
 * not blink empty.
 */
function useFilterGroups(data: ItemsPage | undefined): ItemsFilterGroup[] {
  const types = useJobTypes().data;
  const options = data?.options;
  return useMemo(
    () => [
      { key: "type", label: "Item type", options: ITEMS_REPORT_ITEM_TYPES.map((t) => ({ value: t.id, label: t.label })) },
      { key: "jobTypeId", label: "Job type", options: (types ?? []).map((t) => ({ value: t.id, label: t.name })) },
      { key: "category", label: "Category", options: (options?.categories ?? []).map((c) => ({ value: c, label: c })) },
      { key: "soldBy", label: "Sold by", options: (options?.soldBy ?? []).map((p) => ({ value: p.id, label: p.name })) },
    ],
    [types, options],
  );
}
