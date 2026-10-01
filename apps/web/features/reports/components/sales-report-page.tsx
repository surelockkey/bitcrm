"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Columns3, Download, Search } from "lucide-react";
import { toast } from "sonner";
import {
  SALES_REPORT_BY,
  SALES_REPORT_DEFAULT_SETTINGS,
  SALES_REPORT_PAYMENT_STATUSES,
  SALES_REPORT_STATUSES,
  type SalesReportBy,
  type SalesReportColumnId,
  type SalesReportFilters,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { DateTimeRangePicker } from "@/components/ui/date-time-range-picker";
import { DAY_END, DAY_START, toIsoInstant, toLocalParts } from "@/lib/date-range";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { superStatusLabel } from "@/features/deals/lib";
import { useAllTechnicians } from "@/features/technicians/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { LineChart } from "@/features/dashboard/components/line-chart";
import { JOBS_REPORT_PRESETS, accountToday, presetRange, type JobsReportPreset } from "../jobs/lib";
import { JobsReportFilter, type FilterGroup } from "../jobs/components/jobs-report-filter";
import { JobsReportFields } from "../jobs/components/jobs-report-fields";
import { Pager } from "./jobs-report-page";
import { downloadSalesReportCsv } from "../sales/api";
import { useSalesReport, useSalesReportSettings, useSaveSalesReportSettings } from "../sales/hooks";
import {
  DEFAULT_SALES_PAGE_SIZE,
  DEFAULT_SALES_PRESET,
  SALES_FIELDS,
  SALES_REPORT_BY_LABEL,
  SALES_REPORT_PAGE_SIZES,
  addSalesFilter,
  chartDayLabel,
  inSalesOrder,
  isMoneyColumn,
  nextSalesSort,
  salesExportParams,
  salesReportParams,
  type SalesReportState,
} from "../sales/lib";
import { SalesReportTable } from "../sales/components/sales-report-table";

const BY_STORAGE_KEY = "bitcrm.sales-report.by";

/** The viewer's last "By:" — a per-browser convenience over the account default. */
function storedBy(): SalesReportBy | null {
  try {
    const v = localStorage.getItem(BY_STORAGE_KEY);
    return v && (SALES_REPORT_BY as readonly string[]).includes(v) ? (v as SalesReportBy) : null;
  } catch {
    return null;
  }
}

function rememberBy(by: SalesReportBy): void {
  try {
    localStorage.setItem(BY_STORAGE_KEY, by);
  } catch {
    // Private mode or blocked storage: the account default still applies.
  }
}

const personName = (u: { firstName?: string; lastName?: string; email?: string; id: string }) =>
  `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || u.id;

/**
 * The Workiz Sales report (`/root/sales`): every job of a period that is a
 * sale — any status but Canceled, a total above zero — with its money: Total,
 * Item cost, Tech expenses, Paid, Due, Tax, Profit (before the technician's
 * share) and Tip, under a bold Total row, and a Sales / Profit line per day
 * above. The period is on the date chosen under "By:" (Job date by
 * default); Workiz's six-group filter, its date presets (This month by
 * default), a search, a sort on every column, 10 rows a page, a column
 * chooser saved for the account and a CSV. The server does the work
 * (`GET /deals/report/sales`); this page only holds the toolbar.
 */
export function SalesReportPage({ today: todayProp }: { today?: string } = {}) {
  const denied = useDenied();
  const { can } = usePermissions();
  // The presets count from today on the account's calendar (Eastern), not the viewer's.
  const [today] = useState(() => todayProp ?? accountToday());

  const settingsQuery = useSalesReportSettings();
  const saveSettings = useSaveSalesReportSettings();
  const settings = settingsQuery.data ?? SALES_REPORT_DEFAULT_SETTINGS;

  const [byChoice, setByChoice] = useState<SalesReportBy | null>(storedBy);
  const by = byChoice ?? settings.by;
  const [preset, setPreset] = useState<JobsReportPreset>(DEFAULT_SALES_PRESET);
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: today, to: today });
  const range = preset === "custom" ? custom : presetRange(preset, today);
  const [filters, setFilters] = useState<SalesReportFilters>({});
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 400);
  // Workiz opens on `job_serial desc`: the newest jobs first.
  const [sort, setSort] = useState<{ column: SalesReportColumnId; dir: "asc" | "desc" }>({ column: "jobNumber", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_SALES_PAGE_SIZE);
  const [localColumns, setLocalColumns] = useState<SalesReportColumnId[] | null>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const state: SalesReportState = {
    by,
    from: range.from,
    to: range.to,
    filters,
    search: q,
    sort: sort.column,
    dir: sort.dir,
    page,
    pageSize,
  };
  // The account's "By:" decides the first request — do not ask for the wrong window first.
  const ready = (settingsQuery.isFetched || byChoice !== null) && !denied("reports", "view");
  const report = useSalesReport(salesReportParams(state), ready);
  const data = report.data;

  const money = data?.money ?? can("financials");
  const columns = inSalesOrder(localColumns ?? settings.columns).filter((c) => money || !isMoneyColumn(c));

  const groups = useFilterGroups();

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const changeFilters = resetPage(setFilters);

  const onSort = (column: SalesReportColumnId) => {
    setSort((cur) => nextSalesSort(cur, column));
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await downloadSalesReportCsv(salesExportParams(state, columns));
      if (typeof URL.createObjectURL !== "function") return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sales-report-${state.from}_${state.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const pagination = data?.pagination;
  const chart = data?.chart ?? [];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <Link href="/reports" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Reports
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-lg font-semibold tracking-tight">Sales report</h1>
      </div>

      {/* Workiz's chart over the report: Profit and Sales per day. */}
      {money && data ? (
        <div className="border-b px-4 py-4 sm:px-6">
          <LineChart
            title="Sales and profit per day"
            days={chart.map((d) => d.day)}
            series={[
              { name: "Profit", values: chart.map((d) => d.profit) },
              { name: "Sales", values: chart.map((d) => d.sales) },
            ]}
            labelOf={chartDayLabel}
          />
        </div>
      ) : null}

      {/* Workiz's band: the multi-filter, and the period box with its "By:". */}
      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:px-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <JobsReportFilter<SalesReportFilters> groups={groups} filters={filters} onChange={changeFilters} />
        </div>
        <div className="flex w-full flex-col gap-2 rounded-md border p-2 lg:w-[22rem]">
          <select
            aria-label="Date preset"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={preset}
            onChange={(e) => resetPage(setPreset)(e.target.value as JobsReportPreset)}
          >
            {JOBS_REPORT_PRESETS.map((p) => (
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
          <select
            aria-label="By"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={by}
            onChange={(e) => {
              const next = e.target.value as SalesReportBy;
              setByChoice(next);
              rememberBy(next);
              setPage(1);
            }}
          >
            {SALES_REPORT_BY.map((b) => (
              <option key={b} value={b}>
                By: {SALES_REPORT_BY_LABEL[b]}
              </option>
            ))}
          </select>
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
          {!money ? <span className="text-xs text-muted-foreground">Amounts are hidden — they need the financials permission.</span> : null}
          <span className="flex-1" />
          <select
            aria-label="Rows per page"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={pageSize}
            onChange={(e) => resetPage(setPageSize)(Number(e.target.value))}
          >
            {SALES_REPORT_PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-background" onClick={() => void exportCsv()} disabled={exporting || !data}>
            <Download className="size-3.5" /> {exporting ? "Exporting…" : "Export"}
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 bg-background" onClick={() => setFieldsOpen(true)}>
            <Columns3 className="size-3.5" /> Fields
          </Button>
        </div>

        {report.error ? (
          <p role="alert" className="text-sm text-destructive">
            {report.error instanceof Error ? report.error.message : "Could not load the report."}
          </p>
        ) : !data ? (
          <div role="status" aria-label="Loading sales" className="space-y-2">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            <SalesReportTable
              rows={data.rows}
              totals={data.totals}
              columns={columns}
              sort={data.sort.column}
              dir={data.sort.dir}
              onSort={onSort}
              onStatus={(status) => changeFilters(addSalesFilter(filters, "status", status))}
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

      <JobsReportFields<SalesReportColumnId>
        open={fieldsOpen}
        onOpenChange={setFieldsOpen}
        columns={columns}
        money={money}
        fields={SALES_FIELDS}
        canSave={can("reports", "edit")}
        saving={saveSettings.isPending}
        onApply={(next, persist) => {
          if (!persist) {
            setLocalColumns(next);
            setFieldsOpen(false);
            return;
          }
          saveSettings.mutate(
            { columns: next },
            {
              onSuccess: () => {
                setLocalColumns(null);
                setFieldsOpen(false);
              },
              onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save the fields"),
            },
          );
        }}
      />
    </div>
  );
}

/**
 * The filter's groups, in Workiz's order for this report: the five statuses
 * a sale can have (no sub-statuses, no Canceled), the field team, job types,
 * payment status, sources, service areas. Archived entries stay: last
 * year's jobs still carry them.
 */
function useFilterGroups(): FilterGroup<keyof SalesReportFilters>[] {
  const { can } = usePermissions();
  const { users } = useUserMap();
  // Who is on the field team; without the grant to list them, Team offers everyone.
  const { profiles } = useAllTechnicians(can("technicians", "view"));
  const types = useJobTypes().data;
  const sources = useJobSources().data;
  const areas = useServiceAreas().data;

  return useMemo(() => {
    const byName = <T extends { label: string }>(a: T, b: T) => a.label.localeCompare(b.label);
    const people = users.map((u) => ({ value: u.id, label: personName(u) })).sort(byName);
    const field = new Set(profiles.map((p) => p.userId));
    const team = field.size ? people.filter((p) => field.has(p.value)) : people;
    return [
      { key: "status", label: "Status", options: SALES_REPORT_STATUSES.map((s) => ({ value: s, label: superStatusLabel(s) })) },
      { key: "techId", label: "Team", options: team },
      { key: "jobTypeId", label: "Job type", options: (types ?? []).map((t) => ({ value: t.id, label: t.name })) },
      { key: "paymentStatus", label: "Payment status", options: SALES_REPORT_PAYMENT_STATUSES.map((p) => ({ value: p.id, label: p.label })) },
      { key: "sourceId", label: "Source", options: (sources ?? []).map((s) => ({ value: s.id, label: s.name })).sort(byName) },
      { key: "serviceAreaId", label: "Service areas", options: (areas ?? []).map((a) => ({ value: a.id, label: a.name })).sort(byName) },
    ] satisfies FilterGroup<keyof SalesReportFilters>[];
  }, [users, profiles, types, sources, areas]);
}
