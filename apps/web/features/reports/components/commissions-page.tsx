"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { CommissionReport, CommissionReportBy, CommissionReportMode } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButtonGroup } from "@/components/workiz/button-group";
import { WzLegacyFieldsPanel } from "@/components/workiz/legacy-fields-panel";
import { WzLegacyGrid } from "@/components/workiz/legacy-grid";
import { WzLegacyPillButton, WzLegacySummary } from "@/components/workiz/legacy-report-parts";
import { WzLegacySelect } from "@/components/workiz/legacy-select";
import { WzPeriodPicker } from "@/components/workiz/period-picker";
import { usePageHistoryLabel } from "@/components/shell/page-history";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { useExternalCompanies } from "@/features/external-companies/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { downloadCommissionCsv, reloadCommissionReport, useCommissionReport } from "../commissions/hooks";
import {
  COMMISSION_DATE_PRESETS,
  cellText,
  commissionColumns,
  commissionInfo,
  commissionPresetRange,
  commissionTechOptions,
  loadColumnChoices,
  profitRows,
  saveColumnChoices,
  totalsCell,
  typeRows,
  visibleColumns,
  wzRawNumber,
  type ColumnChoices,
  type CommissionColumn,
  type CommissionDatePreset,
  type CommissionReportFilters,
} from "../commissions/lib";

const ALL = "";
const PAGE_SIZES = [10, 25, 50, 100];
const MODES: { value: CommissionReportMode; label: string }[] = [
  { value: "standard", label: "Standard Report" },
  { value: "tech", label: "Tech Report" },
  { value: "external", label: "External Company" },
];
const BY: { value: CommissionReportBy; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "scheduled", label: "Scheduled" },
  { value: "closed", label: "Closed" },
];

/**
 * Workiz "Commissions (Legacy)" — Finance Reporting — as Workiz draws it
 * (rep_commission_wz_*, 2026-10-09): no heading (the breadcrumb names it),
 * the mode select, the filter row (Job Type · Select Technician · All Service
 * Areas · External Company · Ad Group, compact legacy selects), the yellow
 * Export · Fields · Print, the period box and By Time at the right; Fields
 * slides Workiz's switch panel open; the DataTables grid with the Totals row
 * in its head; Total Profits and Total by type under it.
 *
 * Every Done job of the period with what was collected and how, the
 * technician's rate and profit, the company's and the balance. Amounts need
 * `financials.view` (the server leaves them out too). The office settles
 * technicians weekly from the Tech Report (Last week, Mon – Sun).
 *
 * Not here, Workiz has them: Export By Mail, Send Bulk and Report History
 * (BitCRM sends no mail), the Settlement filter and the settle checkboxes
 * (nobody settles in Workiz), "Balance as of" (the technician's all-time
 * running balance), Invoice, Company Share and Fees By Company.
 */
export function CommissionsPage({ today }: { today: string }) {
  const denied = useDenied();
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  usePageHistoryLabel("Commissions");

  const [mode, setMode] = useState<CommissionReportMode>("standard");
  const [by, setBy] = useState<CommissionReportBy>("closed");
  const [preset, setPreset] = useState<CommissionDatePreset>("today");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [techId, setTechId] = useState(ALL);
  const [jobTypeId, setJobTypeId] = useState(ALL);
  const [serviceAreaId, setServiceAreaId] = useState(ALL);
  const [externalCompanyId, setExternalCompanyId] = useState(ALL);
  const [sourceId, setSourceId] = useState(ALL);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  // Unsorted: Workiz's own order, its job id ascending — the order the jobs were created in.
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [choices, setChoices] = useState<ColumnChoices>(() => loadColumnChoices());
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const choice = choices[mode] ?? {};

  // DataTables searches from the third character; a cleared box searches nothing.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim();
      if (next.length === 0 || next.length >= 3) {
        setQ(next);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const range = preset === "custom" ? custom : commissionPresetRange(preset, today);
  const from = range.from ?? today;
  const to = range.to ?? from;
  const allColumns = commissionColumns(mode);
  const sortKey = sort ? allColumns.find((c) => c.id === sort.id)?.sort : undefined;
  // The Tech Report without a technician is every job (Workiz) — the Standard rows in the Tech columns.
  const everyTech = mode === "tech" && !techId;
  const filters: CommissionReportFilters = {
    from,
    to,
    by,
    mode: everyTech ? "standard" : mode,
    techId: techId || undefined,
    jobTypeId: jobTypeId || undefined,
    serviceAreaId: serviceAreaId || undefined,
    externalCompanyId: externalCompanyId || undefined,
    sourceId: (mode === "standard" && sourceId) || undefined,
    q: q || undefined,
    sort: sortKey ?? "createdAt",
    dir: sortKey ? sort!.dir : "asc",
    offset: (page - 1) * size,
    limit: size,
  };
  const report = useCommissionReport(denied("commission", "view") ? null : filters);

  const jobTypesQuery = useJobTypes();
  const areasQuery = useServiceAreas();
  const companiesQuery = useExternalCompanies();
  const sourcesQuery = useJobSources();
  const people = useUserMap();
  // Each select is drawn holding its options, with the report, in one frame.
  const ready = usePageReady(
    [report, jobTypesQuery, areasQuery, companiesQuery, sourcesQuery].every(settled) && !people.isLoading,
  );

  if (denied("commission", "view")) return <NoAccess entity="the commissions report" />;

  const data = report.data;
  const money = can("financials", "view") && data?.money !== false;
  const columns = visibleColumns(mode, choice, money);

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const changeMode = (next: CommissionReportMode) => {
    setMode(next);
    // Workiz re-renders the page for a mode: the filters stay, Ad Group and the order do not.
    setSourceId(ALL);
    setSort(null);
    setPage(1);
  };
  const toggleColumn = (id: string) => {
    const c = allColumns.find((x) => x.id === id);
    if (!c) return;
    const next = { ...choices, [mode]: { ...choice, [id]: !(choice[id] ?? c.default) } };
    setChoices(next);
    saveColumnChoices(next);
  };
  const onSort = (id: string) => {
    setSort((s) => ({ id, dir: s?.id === id && s.dir === "asc" ? "desc" : "asc" }));
    setPage(1);
  };
  const exportCsv = async () => {
    try {
      await downloadCommissionCsv({ ...filters, mode });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    }
  };
  const reload = async () => {
    setReloading(true);
    try {
      await reloadCommissionReport(queryClient, filters);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reload the report");
    } finally {
      setReloading(false);
    }
  };

  const techOptions = commissionTechOptions(people.users, data?.techs ?? []);
  const companyJobs = new Map((data?.externalCompanies ?? []).map((c) => [c.externalCompanyId, c.jobs]));
  const count = data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / size));

  return (
    // Workiz's report is a white page iframed 14px under the breadcrumb strip.
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-background pt-3.5 text-wz-strong print:overflow-visible">
      <h1 className="sr-only">Commissions</h1>
      {!ready ? (
        <div role="status" aria-label="Loading report" className="space-y-3 px-5 pt-[19px]">
          <Skeleton className="h-[26px] w-[186px]" />
          <Skeleton className="h-[26px] w-[836px]" />
          <Skeleton className="h-8 w-[260px]" />
          <Skeleton className="mt-8 h-[480px] w-full" />
        </div>
      ) : (
        <>
          {/* Workiz's controls: 19px down, the selects, the pills; the period box and By Time at the right. */}
          <div className="relative min-h-[216px] px-5 pt-[19px] pb-[65px] print:hidden">
            <WzLegacySelect
              aria-label="Report mode"
              size="compact"
              className="w-[186px]"
              options={MODES}
              value={mode}
              onChange={(v) => changeMode(v as CommissionReportMode)}
            />
            <div className="mt-5 flex gap-1">
              <WzLegacySelect
                aria-label="Job type"
                size="compact"
                searchable
                className="w-[164px]"
                options={[{ value: ALL, label: "Job Type" }, ...(jobTypesQuery.data ?? []).map((t) => ({ value: t.id, label: t.name }))]}
                value={jobTypeId}
                onChange={reset(setJobTypeId)}
              />
              <WzLegacySelect
                aria-label="Technician"
                size="compact"
                searchable
                className="w-[164px]"
                options={[{ value: ALL, label: "Select Technician" }, ...techOptions]}
                value={techId}
                onChange={reset(setTechId)}
              />
              <WzLegacySelect
                aria-label="Service area"
                size="compact"
                searchable
                className="w-[164px]"
                options={[{ value: ALL, label: "All Service Areas" }, ...(areasQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))]}
                value={serviceAreaId}
                onChange={reset(setServiceAreaId)}
              />
              {/* External Company and Ad Group exclude each other, as in Workiz. */}
              <WzLegacySelect
                aria-label="External company"
                size="compact"
                searchable
                className="w-[164px]"
                disabled={mode === "standard" && Boolean(sourceId)}
                options={[
                  { value: ALL, label: "External Company" },
                  { value: "only", label: "External Only" },
                  ...(companiesQuery.data ?? []).map((c) => ({
                    value: c.id,
                    label: companyJobs.get(c.id) ? `${c.name}   [${companyJobs.get(c.id)}]` : c.name,
                  })),
                ]}
                value={externalCompanyId}
                onChange={reset(setExternalCompanyId)}
              />
              {mode === "standard" ? (
                <WzLegacySelect
                  aria-label="Ad group"
                  size="compact"
                  searchable
                  className="w-[164px]"
                  disabled={Boolean(externalCompanyId)}
                  options={[{ value: ALL, label: "Ad Group" }, ...(sourcesQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))]}
                  value={sourceId}
                  onChange={reset(setSourceId)}
                />
              ) : null}
            </div>
            <div className="mt-7 flex gap-[5px]">
              <WzLegacyPillButton onClick={() => void exportCsv()}>Export</WzLegacyPillButton>
              <WzLegacyPillButton aria-expanded={fieldsOpen} pressed={fieldsOpen} onClick={() => setFieldsOpen((o) => !o)}>
                Fields
              </WzLegacyPillButton>
              <WzLegacyPillButton onClick={() => window.print()}>Print</WzLegacyPillButton>
            </div>
            <div className="absolute top-[62px] right-5 flex flex-col items-end">
              <WzPeriodPicker
                presets={COMMISSION_DATE_PRESETS}
                preset={preset}
                range={{ from, to }}
                onPresetChange={(p) => {
                  // Custom opens on the days on show, so the report does not jump.
                  if (p === "custom") setCustom({ from, to });
                  reset(setPreset)(p);
                }}
                onCustomChange={(days) => {
                  setCustom(days);
                  setPage(1);
                }}
                today={today}
              />
              <div className="mt-[19px] flex items-center gap-[3px]">
                <span className="text-sm leading-[34px] tracking-[0.4px]">By Time:</span>
                <WzButtonGroup aria-label="By Time" options={BY} value={by} onChange={reset(setBy)} />
              </div>
            </div>
          </div>

          {fieldsOpen ? (
            <WzLegacyFieldsPanel
              className="mx-5 mt-5 mb-9 print:hidden"
              fields={commissionColumns(mode, money).map((c) => ({ id: c.id, label: c.label, on: choice[c.id] ?? c.default }))}
              onToggle={toggleColumn}
              onClose={() => setFieldsOpen(false)}
            />
          ) : null}

          {data?.warnings.length ? (
            <ul role="alert" className="px-5 pb-2 text-xs leading-4 text-wz-danger print:hidden">
              {data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          <div className="hidden px-5 pb-3 print:block">
            <p className="text-lg font-semibold">
              Finance Reporting — {MODES.find((m) => m.value === mode)?.label}
              {techId ? ` — ${techOptions.find((t) => t.value === techId)?.label.replace(/\s+\[\d+\]$/, "") ?? ""}` : ""}
            </p>
            <p className="text-sm">
              {from} to {to}, by {by}
            </p>
          </div>

          {report.error ? (
            <p role="alert" className="p-5 text-sm text-destructive">
              {report.error instanceof Error ? report.error.message : "Could not load the report."}
            </p>
          ) : !data ? (
            <div role="status" aria-label="Loading report" className="px-5">
              <Skeleton className="h-[480px] w-full" />
            </div>
          ) : (
            <>
              <WzLegacyGrid
                aria-label="Commissions"
                columns={columns.map((c) => ({ id: c.id, label: c.label, sortable: Boolean(c.sort) }))}
                rows={data.rows.map((r) => ({
                  key: r.dealId,
                  cells: columns.map((c) =>
                    c.id === "dealNumber" ? (
                      <Link key={c.id} href={`/deals/${r.dealId}`} className="text-foreground underline">
                        {r.dealNumber}
                      </Link>
                    ) : (
                      cellText(r, c.id)
                    ),
                  ),
                }))}
                totals={columns.map((c, i) => totalsCell(data, c, i))}
                sort={sort}
                onSort={onSort}
                pageSize={size}
                pageSizes={PAGE_SIZES}
                onPageSize={(s) => {
                  setSize(s);
                  setPage(1);
                }}
                search={search}
                onSearch={setSearch}
                onRefresh={() => void reload()}
                info={commissionInfo(page, size, count)}
                onPrevious={page > 1 ? () => setPage(page - 1) : undefined}
                onNext={page < pages ? () => setPage(page + 1) : undefined}
                busy={reloading || report.isFetching === true}
              />
              {money ? <Summaries report={data} mode={mode} /> : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Total Profits and Total by type, the two halves under the grid (21px in, 31px apart). */
function Summaries({ report, mode }: { report: CommissionReport; mode: CommissionReportMode }) {
  return (
    <div className="grid grid-cols-2 gap-[31px] pt-[52px] pr-5 pb-10 pl-[21px] print:break-inside-avoid">
      <WzLegacySummary
        title="Total Profits"
        columns={["Profit For", "Amount"]}
        rows={profitRows(mode, report.count).map((r) => ({ key: r.key, cells: [r.label, wzRawNumber(report.totals[r.key].amount)] }))}
      />
      <WzLegacySummary
        title="Total by type"
        columns={["Type", "Total", "Jobs"]}
        rows={typeRows(report.count).map((r) => ({
          key: r.key,
          cells: [r.label, wzRawNumber(report.totals[r.key].amount), String(report.totals[r.key].jobs)],
        }))}
      />
    </div>
  );
}

export type { CommissionColumn };
