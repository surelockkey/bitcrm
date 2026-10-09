"use client";

import { useMemo, useState } from "react";
import { FileText, Grid3x3 } from "lucide-react";
import { toast } from "sonner";
import {
  JOBS_REPORT_BY,
  JOBS_REPORT_BY_LABEL,
  JOBS_REPORT_DEFAULT_SETTINGS,
  type JobsReportBy,
  type JobsReportColumnId,
  type JobsReportFilters,
} from "@bitcrm/types";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { WzGroupedFilter, type WzFilterGroup } from "@/components/workiz/grouped-filter";
import { WzPickerSelect } from "@/components/workiz/picker-select";
import { WzPager, type WzPagerState } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { usePageHistoryLabel } from "@/components/shell/page-history";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { useAllTechnicians } from "@/features/technicians/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { tagSolidClasses } from "@/features/job-tags/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { useExternalCompanies } from "@/features/external-companies/hooks";
import { downloadJobsReportCsv } from "../jobs/api";
import { useJobsReport, useJobsReportSettings, useSaveJobsReportSettings } from "../jobs/hooks";
import {
  DEFAULT_PRESET,
  FILTER_CHIP_ORDER,
  JOBS_REPORT_PAGE_SIZES,
  JOBS_REPORT_PRESETS,
  addFilter,
  exportParams,
  inReportOrder,
  presetRange,
  reportParams,
  statusFilterOptions,
  viewerToday,
  type JobsReportPreset,
  type JobsReportState,
} from "../jobs/lib";
import { JobsReportFields } from "../jobs/components/jobs-report-fields";
import { JobsReportTable, JobsReportTableShell } from "../jobs/components/jobs-report-table";

const BY_STORAGE_KEY = "bitcrm.jobs-report.by";

/** The viewer's last "By:" — a per-browser convenience over the account default. */
function storedBy(): JobsReportBy | null {
  try {
    const v = localStorage.getItem(BY_STORAGE_KEY);
    return v && (JOBS_REPORT_BY as readonly string[]).includes(v) ? (v as JobsReportBy) : null;
  } catch {
    return null;
  }
}

function rememberBy(by: JobsReportBy): void {
  try {
    localStorage.setItem(BY_STORAGE_KEY, by);
  } catch {
    // Private mode or blocked storage: the account default still applies.
  }
}

const personName = (u: { firstName?: string; lastName?: string; email?: string; id: string }) =>
  `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || u.id;

const BY_OPTIONS = JOBS_REPORT_BY.map((b) => ({ value: b, label: JOBS_REPORT_BY_LABEL[b] }));
const PRESETS = JOBS_REPORT_PRESETS.map((p) => ({ id: p.id, label: p.label }));

/**
 * The Workiz Jobs report (`/root/jobreport`), drawn as Workiz draws it
 * (rep_jobs_wz_*): no title — the "Filter results" box across the top, the
 * date box with its "By:" row at the right; the list strip (Search, page
 * size, Export, Fields); the grid; the pager. Every job of the period, any
 * status, on the date "By:" names — Job created, Job date or Job end date.
 * The server does the work (`GET /deals/report`): it pages, sorts and names;
 * this page holds the toolbar. The page scrolls only up and down, as
 * Workiz's does (the 2026-10-09 probe of /root/jobreport/): the grid's
 * header is pinned to its top, and a grid wider than the page scrolls
 * sideways in its own box (`WzScrollGrid`), the controls above it still.
 */
export function JobsReportPage({ today: todayProp }: { today?: string } = {}) {
  const denied = useDenied();
  const { can } = usePermissions();
  usePageHistoryLabel("Jobs Report");
  // Workiz counts its presets from the viewer's own clock (moment()).
  const [today] = useState(() => todayProp ?? viewerToday());

  const settingsQuery = useJobsReportSettings();
  const saveSettings = useSaveJobsReportSettings();
  const settings = settingsQuery.data ?? JOBS_REPORT_DEFAULT_SETTINGS;

  const [byChoice, setByChoice] = useState<JobsReportBy | null>(storedBy);
  const by = byChoice ?? settings.by;
  const [range, setRange] = useState<WzDateRange>(() => ({ preset: DEFAULT_PRESET, ...presetRange(DEFAULT_PRESET, today) }));
  const [filters, setFilters] = useState<JobsReportFilters>({});
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 400);
  const [sort, setSort] = useState<{ column: JobsReportColumnId; dir: "asc" | "desc" }>({ column: "created", dir: "desc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [localColumns, setLocalColumns] = useState<JobsReportColumnId[] | null>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const state: JobsReportState = {
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
  const ready = settingsQuery.isFetched || byChoice !== null;
  const report = useJobsReport(reportParams(state), ready);
  const data = report.data;
  // A browser that remembers its "By:" asks before the settings are in, and
  // the table was drawn with the default columns, then redrawn with the
  // account's own: every column slid. It waits for the columns it shows.
  const shown = usePageReady([report, settingsQuery].every(settled));

  const money = data?.money ?? can("financials");
  const columns = inReportOrder(localColumns ?? settings.columns).filter((c) => money || c !== "total");

  const groups = useFilterGroups();

  if (denied("reports", "view")) return <NoAccess entity="reports" />;

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };
  const changeFilters = resetPage(setFilters);

  const onSort = (column: JobsReportColumnId) => {
    setSort((cur) => (cur.column === column ? { column, dir: cur.dir === "asc" ? "desc" : "asc" } : { column, dir: column === "created" ? "desc" : "asc" }));
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await downloadJobsReportCsv(exportParams(state, columns));
      if (typeof URL.createObjectURL !== "function") return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jobs-report-${state.from}_${state.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const p = data?.pagination;
  const pager: WzPagerState = {
    page: p?.page ?? 1,
    from: p?.from ?? 0,
    to: p?.to ?? 0,
    total: p?.total ?? 0,
    totalPages: p?.pages ?? 1,
    canPrev: (p?.page ?? 1) > 1,
    canNext: (p?.page ?? 1) < (p?.pages ?? 1),
    isFetching: report.isFetching,
    prev: () => setPage((n) => Math.max(1, n - 1)),
    next: () => setPage((n) => Math.min(p?.pages ?? n, n + 1)),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto text-wz-strong" data-slot="jobs-report-scroller">
      {/* The top band (rep_jobs_wz_01_default): the filter 34px under the
          breadcrumbs, 21px in, running to 20px short of the date box; the
          box 20px off the right edge; 30px under it to the strip. A layer
          of its own: z-20 lets the date lists hang over the strip and the
          grid's pinned header below it. */}
      <div className="relative z-20 flex shrink-0 items-start gap-5 pt-[34px] pr-5 pb-[30px] pl-[21px]">
        <WzGroupedFilter<keyof JobsReportFilters>
          className="min-w-0 flex-1"
          groups={groups}
          value={filters}
          onChange={(next) => changeFilters(next as JobsReportFilters)}
          chipOrder={FILTER_CHIP_ORDER}
        />
        <div className={range.preset === "custom" ? "w-[362px] shrink-0" : "w-[250px] shrink-0"}>
          <WzDateRangePicker
            presets={PRESETS}
            value={range}
            onChange={(next) => {
              setRange(next);
              setPage(1);
            }}
            rangeOf={(id) => (id === "custom" ? null : presetRange(id as Exclude<JobsReportPreset, "custom">, today))}
            calendar={{ today }}
          />
          <WzPickerSelect
            prefix="By"
            options={BY_OPTIONS}
            value={by}
            onChange={(next) => {
              setByChoice(next);
              rememberBy(next);
              setPage(1);
            }}
          />
        </div>
      </div>

      <WzListToolbar className="gap-x-4">
        <WzSearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect value={pageSize} sizes={JOBS_REPORT_PAGE_SIZES} onChange={resetPage(setPageSize)} />
          <WzToolbarButton onClick={() => void exportCsv()} disabled={exporting || !data}>
            <FileText strokeWidth={1.5} /> {exporting ? "Exporting…" : "Export"}
          </WzToolbarButton>
          {/* list strip: Export → Fields is 17px, page size → Export 16px. */}
          <WzToolbarButton className="ml-px" onClick={() => setFieldsOpen(true)}>
            <Grid3x3 strokeWidth={1.75} /> Fields
          </WzToolbarButton>
        </div>
      </WzListToolbar>

      <div className="flex-1">
        {report.error ? (
          <p role="alert" className="px-5 py-4 text-sm text-destructive">
            {report.error instanceof Error ? report.error.message : "Could not load the report."}
          </p>
        ) : !shown || !data ? (
          <JobsReportTableShell columns={columns} />
        ) : (
          <JobsReportTable
            rows={data.rows}
            columns={columns}
            sort={data.sort.column}
            dir={data.sort.dir}
            onSort={onSort}
            addFilter={(key, value) => changeFilters(addFilter(filters, key, value))}
            busy={report.isFetching}
          />
        )}
      </div>
      {shown && data ? <WzPager pager={pager} /> : null}

      <JobsReportFields
        open={fieldsOpen}
        onOpenChange={setFieldsOpen}
        columns={columns}
        money={money}
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
 * The filter's groups, in Workiz's order (rep_jobs_wz_05_filter_open), from
 * the catalogs the app already holds: STATUS (each with its sub-statuses),
 * TEAM (the field team), CREATED BY, TAGS, JOB TYPE, JOB ORIGIN, SOURCE,
 * SERVICE AREAS and COMPANIES — the last two only when the account has any,
 * as Workiz. Each chip starts with Workiz's filter key ("user: …").
 * Archived entries stay: last year's jobs still carry them.
 */
function useFilterGroups(): WzFilterGroup<keyof JobsReportFilters>[] {
  const { can } = usePermissions();
  const { users } = useUserMap();
  // Who is on the field team; without the grant to list them, Team offers everyone.
  const { profiles } = useAllTechnicians(can("technicians", "view"));
  const statuses = useJobStatuses().data;
  const tags = useJobTags().data;
  const types = useJobTypes().data;
  const sources = useJobSources().data;
  const areas = useServiceAreas().data;
  const companies = useExternalCompanies().data;

  return useMemo(() => {
    const byName = <T extends { label: string }>(a: T, b: T) => a.label.localeCompare(b.label);
    const people = users.map((u) => ({ value: u.id, label: personName(u) })).sort(byName);
    const field = new Set(profiles.map((p) => p.userId));
    const team = field.size ? people.filter((p) => field.has(p.value)) : people;
    const groups: WzFilterGroup<keyof JobsReportFilters>[] = [
      { key: "status", label: "Status", chip: "status", options: statusFilterOptions(statuses ?? []) },
      { key: "techId", label: "Team", chip: "user", options: team },
      { key: "createdBy", label: "Created By", chip: "created_by", options: people },
      {
        key: "tagId",
        label: "Tags",
        chip: "tag",
        options: (tags ?? []).map((t) => ({ value: t.id, label: t.name, className: tagSolidClasses(t.color) })),
      },
      { key: "jobTypeId", label: "Job type", chip: "type", options: (types ?? []).map((t) => ({ value: t.id, label: t.name })) },
      {
        key: "origin",
        label: "Job origin",
        chip: "job_origin",
        options: [
          { value: "lead", label: "Lead" },
          { value: "new", label: "New" },
        ],
      },
      { key: "sourceId", label: "Source", chip: "source", options: (sources ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { key: "serviceAreaId", label: "Service Areas", chip: "metro", options: (areas ?? []).map((a) => ({ value: a.id, label: a.name })) },
      { key: "externalCompanyId", label: "Companies", chip: "company", options: (companies ?? []).map((c) => ({ value: c.id, label: c.name })) },
    ];
    return groups.filter((g) => !(g.key === "serviceAreaId" || g.key === "externalCompanyId") || g.options.length > 0);
  }, [users, profiles, statuses, tags, types, sources, areas, companies]);
}
