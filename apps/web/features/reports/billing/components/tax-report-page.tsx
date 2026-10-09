"use client";

import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { TAX_REPORT_BY, TAX_REPORT_BY_LABELS, type TaxReportBasis, type TaxReportBy, type TaxReportRow } from "@bitcrm/types";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzPager } from "@/components/workiz/pager";
import { WzPickerSelect } from "@/components/workiz/picker-select";
import { WzReportGrid, wzNextSort, type WzReportColumn } from "@/components/workiz/report-grid";
import { WzTabBar } from "@/components/workiz/tab-bar";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { usePageHistoryLabel } from "@/components/shell/page-history";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { DEFAULT_REPORT_PAGE_SIZE, REPORT_PAGE_SIZES, paymentsCustomCheck } from "@/features/payments/report";
import { viewerToday } from "@/features/reports/jobs/lib";
import { exportTaxReport } from "../api";
import { agingPager } from "../aging";
import { useTaxReport } from "../hooks";
import { downloadCsv } from "../lib";
import {
  DEFAULT_TAX_BY,
  DEFAULT_TAX_REPORT_PRESET,
  TAX_DEFAULT_SORT,
  TAX_REPORT_PRESETS,
  defaultTaxParams,
  orderTaxRows,
  taxColumnIds,
  taxColumnLabel,
  taxFilterOptions,
  taxKpi,
  taxPresetRange,
  taxRateText,
  taxReportParams,
  type TaxColumnId,
  type TaxGridSort,
  type TaxReportPreset,
} from "../tax";
import { money } from "./report-bits";

const TABS = [
  { value: "accrual", label: "Accrual" },
  { value: "paid", label: "Paid" },
] as const;

const BY_OPTIONS = TAX_REPORT_BY.map((b) => ({ value: b, label: TAX_REPORT_BY_LABELS[b] }));

/** A value alone in its cell: one line, cut at the cell's edge as react-table cuts it. */
const Text = ({ children }: { children?: ReactNode }) => <span className="block truncate">{children}</span>;

const CELLS: Record<TaxColumnId, (r: TaxReportRow) => ReactNode> = {
  name: (r) => <Text>{r.name.trim()}</Text>,
  description: (r) => <Text>{r.description}</Text>,
  rate: (r) => <Text>{taxRateText(r.rate)}</Text>,
  amount: (r) => <Text>{money(r.amount)}</Text>,
  taxableAmount: (r) => <Text>{money(r.taxableAmount)}</Text>,
  nonTaxableAmount: (r) => <Text>{money(r.nonTaxableAmount)}</Text>,
  jobs: (r) => <Text>{r.jobs}</Text>,
};

const columnsOf = (basis: TaxReportBasis): WzReportColumn<TaxReportRow>[] =>
  taxColumnIds(basis).map((id) => ({ id, label: taxColumnLabel(id, basis), sortable: true, cell: CELLS[id] }));

/**
 * Workiz Reports → Tax (`/root/tax_report/`), drawn as Workiz draws it
 * (rep_tax_wz_*): no title — the Accrual / Paid tabs; under them the
 * sentence "$X total tax on sold items" over "Tax to show", the date box
 * (with "By:" on Accrual) at the right; the list strip; the grid with the
 * pager inside it. One row per tax rate.
 *
 * Each tab is a page of its own, as in Workiz: opening one starts it on This
 * month, Job end date, every tax, Name. Both tabs' opening questions are
 * asked with the page, so a tab opens whole at once.
 *
 * Nothing here is not money: the page needs `reports.view` and
 * `financials.view` (the server says the same).
 */
export function TaxReportPage({ today: todayProp }: { today?: string } = {}) {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  usePageHistoryLabel("Tax Report");
  const canView = can("reports", "view") && can("financials", "view");
  // Workiz counts its presets from the viewer's own clock (moment()).
  const [today] = useState(() => todayProp ?? viewerToday());
  const [basis, setBasis] = useState<TaxReportBasis>("accrual");

  const accrual = useTaxReport(defaultTaxParams("accrual", today), canView);
  const paid = useTaxReport(defaultTaxParams("paid", today), canView);
  // The sentence, the rates and the rows come in one frame (the figure was
  // drawn as "—" and its caption slid when it came); until the role is read
  // nothing is asked, which is not an answer.
  const shown = usePageReady(!permsLoading && settled(accrual) && settled(paid));

  if (denied("reports", "view") || denied("financials", "view")) return <NoAccess what="the tax report" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="tax-report">
      {/* The tab row (rep_tax_wz_01_default): the words 18px under the
          breadcrumbs, its rule at the foot of the open tab's bar. */}
      <WzTabBar
        aria-label="Tax report"
        className="mt-[18px] shrink-0"
        tabs={TABS}
        value={basis}
        onValueChange={(v) => setBasis(v as TaxReportBasis)}
      />
      <TaxTab key={basis} basis={basis} today={today} enabled={canView} shown={shown} />
    </div>
  );
}

function TaxTab({ basis, today, enabled, shown }: { basis: TaxReportBasis; today: string; enabled: boolean; shown: boolean }) {
  const [range, setRange] = useState<WzDateRange>(() => ({
    preset: DEFAULT_TAX_REPORT_PRESET,
    ...taxPresetRange(DEFAULT_TAX_REPORT_PRESET, today),
  }));
  const [by, setBy] = useState<TaxReportBy>(DEFAULT_TAX_BY);
  const [tax, setTax] = useState("0");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 300);
  const [sort, setSort] = useState<TaxGridSort>(TAX_DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_REPORT_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);

  const custom = paymentsCustomCheck(range);
  const params = taxReportParams({ basis, by, range, tax, search });
  const q = useTaxReport(params, enabled && custom.usable);

  // A new question starts on its first page — reset while rendering, not in an effect.
  const key = JSON.stringify(params);
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    if (page !== 1) setPage(1);
  }

  const r = shown ? q.data : undefined;
  const rows = orderTaxRows(r?.rows ?? [], sort, basis);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const pager = agingPager({ page, pageSize, total: rows.length, shown: pageRows.length, fetching: q.isFetching, onPage: setPage });

  const onSort = (column: string) => {
    setSort((s) => ({ column: column as TaxColumnId, dir: s.column === column ? wzNextSort(s.dir) : "asc" }));
    setPage(1);
  };
  const runExport = async () => {
    setExporting(true);
    try {
      const out = await exportTaxReport(params);
      downloadCsv(out.filename, out.csv);
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Couldn't export the report"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {/* The band (`flexCont _wp`, 20px all round): the sentence and "Tax to
          show" in a 480px column; the date box 20px off the right edge, 10px
          clear of the strip. */}
      <div className="flex shrink-0 items-start justify-between gap-5 p-5">
        <div className="w-[480px] min-w-0 shrink">
          {r ? (
            <h2 className="text-xl leading-6 font-semibold text-foreground" data-testid="tax-kpi">
              {taxKpi(basis, r.totalAmount)}
            </h2>
          ) : (
            // The sentence's own line while the report is on its way (Workiz prints "$0.00 …" first).
            <Skeleton className="h-6 w-[340px] rounded-none" role="status" aria-label="Loading the tax report" />
          )}
          <WzOutlinedSelect
            className="mt-7"
            label="Tax to show"
            options={taxFilterOptions(r?.taxes ?? [])}
            value={tax}
            onChange={setTax}
          />
        </div>
        <div className={range.preset === "custom" ? "mb-2.5 w-[362px] shrink-0" : "mb-2.5 w-[250px] shrink-0"}>
          <WzDateRangePicker
            presets={TAX_REPORT_PRESETS}
            value={range}
            onChange={setRange}
            rangeOf={(id) => (id === "custom" ? null : taxPresetRange(id as Exclude<TaxReportPreset, "custom">, today))}
            customError={custom.error}
            calendar={{ today }}
          />
          {basis === "accrual" ? <WzPickerSelect prefix="By" options={BY_OPTIONS} value={by} onChange={setBy} /> : null}
        </div>
      </div>

      <WzListToolbar className="shrink-0">
        <WzSearchBox value={searchInput} onChange={setSearchInput} />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect
            value={pageSize}
            sizes={REPORT_PAGE_SIZES}
            onChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
          />
          <WzToolbarButton onClick={() => void runExport()} disabled={exporting || !r || !custom.usable}>
            <FileText strokeWidth={1.5} /> {exporting ? "Exporting…" : "Export"}
          </WzToolbarButton>
        </div>
      </WzListToolbar>

      <div className="shrink-0">
        {q.isError && !q.data ? (
          <p role="alert" className="px-5 py-4 text-sm text-destructive">
            {getApiErrorMessage(q.error, "Couldn't load the tax report")}
          </p>
        ) : (
          <WzReportGrid
            aria-label={basis === "accrual" ? "Accrual" : "Paid"}
            columns={columnsOf(basis)}
            rows={pageRows}
            rowKey={(row) => row.key}
            sort={sort}
            onSort={onSort}
            loading={!r}
            busy={q.isPlaceholderData}
            plainFiller
            footer={r ? <WzPager pager={pager} plainNumbers /> : null}
          />
        )}
      </div>
    </>
  );
}
