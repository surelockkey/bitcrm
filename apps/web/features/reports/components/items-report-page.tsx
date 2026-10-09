"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import type { ItemsReportFilters, ItemsReportSort } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { usePageHistoryLabel } from "@/components/shell/page-history";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { WzGroupedFilter } from "@/components/workiz/grouped-filter";
import { WzPager } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { personName } from "@/features/deals/person-name";
import { useItemCategories } from "@/features/inventory/products/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { viewerToday } from "../jobs/lib";
import { downloadItemsReportCsv } from "../items/api";
import { useItemsReport } from "../items/hooks";
import {
  DEFAULT_ITEMS_PRESET,
  ITEMS_FILTER_CHIP_ORDER,
  ITEMS_REPORT_PAGE_SIZES,
  ITEMS_REPORT_PRESETS,
  itemsCustomCheck,
  itemsExportParams,
  itemsFilterGroups,
  itemsPager,
  itemsPresetRange,
  itemsReportParams,
  nextSort,
  type ItemsReportPreset,
  type ItemsReportState,
} from "../items/lib";
import { ItemsReportTable } from "../items/components/items-report-table";

const PRESETS = ITEMS_REPORT_PRESETS.map((p) => ({ id: p.id, label: p.label }));

/**
 * Workiz Reports → Items and services (`/root/itemsReport`), drawn as Workiz
 * draws it (rep_items_wz_*; notes docs/import/app-parity-2026-10-08/rep_items.md):
 * no title; the "Filter results" box (Item type, Job type, Category, Sold by)
 * beside the date box; the list strip (Search, page size, Export); the grid
 * — the bold Total row first, then every price-book item the period's Done
 * jobs sold, on their job date: units, price, cost, profit with its margin,
 * jobs — each ▸ opening the jobs that used it; the pager inside the frame.
 * The server counts, sorts and pages (`GET /deals/report/items`).
 *
 * Money (Price, Cost, Profit) needs `financials.view`. Workiz's "Meet Price
 * Book Pro catalog!" banner over the filter is an upsell of Workiz's own and
 * is left out.
 */
export function ItemsReportPage({ today: todayProp }: { today?: string } = {}) {
  usePageHistoryLabel("Items Report");
  const denied = useDenied();
  const { can } = usePermissions();
  // Workiz counts its presets from the viewer's own clock (moment()).
  const [today] = useState(() => todayProp ?? viewerToday());

  const [range, setRange] = useState<WzDateRange>(() => ({ preset: DEFAULT_ITEMS_PRESET, ...itemsPresetRange(DEFAULT_ITEMS_PRESET, today) }));
  const [filters, setFilters] = useState<ItemsReportFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const q = useDebouncedValue(searchInput, 400);
  // Workiz opens on `item_id desc` — the newest items first, no header marked.
  const [sort, setSort] = useState<{ column: ItemsReportSort; dir: "asc" | "desc" }>({ column: "number", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [exporting, setExporting] = useState(false);

  // A Custom range over twelve months is refused in the box and never asked
  // for: the report keeps the last answer on screen, as Workiz does.
  const custom = itemsCustomCheck(range);

  // A new question starts from its first page — reset while rendering, so no
  // frame shows page 3 of a set that has none.
  const questionKey = JSON.stringify([range.from, range.to, filters, q, sort, pageSize]);
  const [seenKey, setSeenKey] = useState(questionKey);
  if (seenKey !== questionKey) {
    setSeenKey(questionKey);
    if (page !== 1) setPage(1);
  }

  const state: ItemsReportState = { from: range.from, to: range.to, filters, search: q, sort: sort.column, dir: sort.dir, page, pageSize };
  const report = useItemsReport(itemsReportParams(state), !denied("reports", "view") && custom.usable);
  const data = report.data;
  const money = data?.money ?? can("financials");
  const groups = useFilterGroups(data?.options);

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-background text-wz-strong" data-slot="items-report-scroller">
      {/* The band (rep_items_wz_01_loaded): 20px all round; the 48.64px
          filter from 20px in to 20px short of the date box; the strip 30px
          under the box. */}
      <div className="flex shrink-0 items-start gap-5 px-5 pt-5 pb-[30px]">
        <WzGroupedFilter<keyof ItemsReportFilters>
          size="tall"
          className="min-w-0 flex-1"
          placeholder="Filter results"
          groups={groups}
          chipOrder={ITEMS_FILTER_CHIP_ORDER}
          value={filters}
          onChange={(next) => setFilters(next as ItemsReportFilters)}
        />
        <WzDateRangePicker
          presets={PRESETS}
          value={range}
          onChange={setRange}
          rangeOf={(id) => (id === "custom" ? null : itemsPresetRange(id as Exclude<ItemsReportPreset, "custom">, today))}
          customError={custom.error}
          calendar={{ today }}
        />
      </div>

      <WzListToolbar className="shrink-0">
        <WzSearchBox value={searchInput} onChange={setSearchInput} />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect value={pageSize} sizes={ITEMS_REPORT_PAGE_SIZES} onChange={setPageSize} />
          <WzToolbarButton onClick={() => void exportCsv()} disabled={exporting || !data || !custom.usable}>
            <FileText strokeWidth={1.5} /> {exporting ? "Exporting…" : "Export"}
          </WzToolbarButton>
        </div>
      </WzListToolbar>

      <div className="shrink-0">
        {report.error ? (
          <div className="border border-wz-frame px-5 py-10 text-center text-sm">
            <p role="alert">{report.error instanceof Error ? report.error.message : "Could not load the report."}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void report.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <ItemsReportTable
            // A new period or filter closes every opened item.
            key={`${state.from}|${state.to}|${JSON.stringify(filters)}|${q}`}
            rows={data?.rows ?? []}
            totals={data?.totals}
            money={money}
            sort={data?.sort.column ?? sort.column}
            dir={data?.sort.dir ?? sort.dir}
            onSort={(column) => setSort((cur) => nextSort(cur, column))}
            state={state}
            loading={!data}
            busy={report.isPlaceholderData && report.isFetching}
            footer={
              <WzPager
                plainNumbers
                loading={!data}
                pager={itemsPager(data?.pagination ?? { page, pageSize, total: 0, pages: 1, from: 0, to: 0 }, setPage, report.isFetching)}
              />
            }
          />
        )}
      </div>
    </div>
  );
}

/**
 * The filter's lists, in Workiz's order: the six item types, every job type,
 * the price book's categories and everyone in the directory (Workiz names),
 * plus whatever the period's own answer holds that those lack. The lists
 * only feed the closed filter, so the grid does not wait for them.
 */
function useFilterGroups(options: { categories: string[]; soldBy: { id: string; name: string }[] } | undefined) {
  const { can, isLoading } = usePermissions();
  const types = useJobTypes().data;
  const categories = useItemCategories(isLoading || can("product_categories", "view")).data;
  const { users } = useUserMap();
  return useMemo(
    () =>
      itemsFilterGroups({
        jobTypes: (types ?? []).map((t) => ({ id: t.id, name: t.name })),
        categories: (categories ?? []).map((c) => c.name),
        periodCategories: options?.categories ?? [],
        people: users.flatMap((u) => {
          const name = personName(u);
          return name ? [{ id: u.id, name }] : [];
        }),
        periodSellers: options?.soldBy ?? [],
      }),
    [types, categories, users, options],
  );
}
