"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  ACTIVITY_DEFAULT_PAGE_SIZE,
  ACTIVITY_MAX_USERS,
  ACTIVITY_PAGE_SIZES,
  UserStatus,
  type ActivityRow,
} from "@bitcrm/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { WzGroupedFilter, type WzFilterGroup, type WzFilterValue } from "@/components/workiz/grouped-filter";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, wzNextSort, type WzReportColumn, type WzSortDir } from "@/components/workiz/report-grid";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { personName } from "@/features/deals/person-name";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePager } from "@/lib/paging/use-pager";
import { ACTIVITY_PRESETS, REPORT_PRESET_LABEL, reportPresetRange, reportToday, type ReportPreset } from "../report-dates";
import { exportActivity, useActivity, useActivityCount } from "../activity/hooks";
import { activityCsv, activityTime, activityUser, type ActivityFilter } from "../activity/lib";
import { ActivityDeviceIcon } from "../activity/device-icon";

/** How long the search waits for the typing to stop. */
const SEARCH_DELAY_MS = 400;

const PRESETS = ACTIVITY_PRESETS.map((id) => ({ id, label: REPORT_PRESET_LABEL[id] }));

/** The filter's one group: Workiz's TEAM, its chips "uid: <name>" (rep_activity_wz_11). */
type TeamKey = "uid";

/**
 * Workiz Reports → Activity (`/root/activity`), drawn as Workiz draws it
 * (rep_activity_wz_*): no title — "Filter results" across the top with the
 * date box at its right (no "By:" row); the list strip (Search, page size,
 * Export); the four-column grid; the pager. Who did what and when, today by
 * default, newest first. The presets count from the viewer's own today and
 * the server reads those days on the account's calendar, as Workiz's do.
 * "Filter results" narrows to current teammates (Workiz's own list), the
 * search matches the action and the Job Id, the Time header sorts, and
 * Export writes the four columns as CSV (at most 10,000 rows, as Workiz).
 * Pages walk the server's cursor.
 */
export function ActivityPage({ today: todayProp }: { today?: string } = {}) {
  const denied = useDenied();
  const blocked = denied("reports", "view");
  const [today] = useState(() => todayProp ?? reportToday());

  const [range, setRange] = useState<WzDateRange>(() => ({ preset: "today", ...reportPresetRange("today", today)! }));
  const [team, setTeam] = useState<WzFilterValue<TeamKey>>({});
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, SEARCH_DELAY_MS);
  // Workiz opens unsorted (newest first, no bar); the header then sorts ascending first.
  const [sort, setSort] = useState<WzSortDir | null>(null);
  const [pageSize, setPageSize] = useState<number>(ACTIVITY_DEFAULT_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);

  const filter: ActivityFilter = { from: range.from, to: range.to, userIds: team.uid ?? [], q, sort: sort ?? "desc" };

  const list = useActivity(filter, pageSize, !blocked);
  const count = useActivityCount(filter, !blocked);
  const pager = usePager(pagedSource(list), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ ...filter, pageSize }),
  });

  const { isLoading: permsLoading } = usePermissions();
  const { map: userMap, users, isLoading: namesLoading } = useUserMap();
  const directoryName = (id: string) => personName(userMap.get(id));
  const groups = useMemo<WzFilterGroup<TeamKey>[]>(
    () => [
      {
        key: "uid",
        label: "Team",
        chip: "uid",
        options: users
          .filter((u) => (u as { status?: string }).status !== UserStatus.INACTIVE)
          .map((u) => ({ value: u.id, label: personName(u) ?? u.id }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
    ],
    [users],
  );

  // The footer stood under grey rows from the first frame: the rows pushed it
  // down, its "of N" grew it a beat later, and the User column turned from
  // stored e-mails into names when the directory came. The table, the total
  // and the names come in one frame.
  const ready = usePageReady([list, count].every(settled) && !permsLoading && !namesLoading);

  if (blocked) return <NoAccess entity="reports" />;

  const onExport = async () => {
    setExporting(true);
    try {
      const out = await exportActivity(filter);
      const blob = new Blob([activityCsv(out.rows, directoryName)], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `activity-${filter.from}_${filter.to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (out.truncated) toast.info("The first 10,000 rows were exported — narrow the period for the rest.");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const changeTeam = (next: WzFilterValue<TeamKey>) => {
    const picked = next.uid ?? [];
    // The server answers for up to twenty people at once (one index walk each).
    if (picked.length > ACTIVITY_MAX_USERS) {
      toast.info(`Filter by up to ${ACTIVITY_MAX_USERS} teammates at once.`);
      return;
    }
    setTeam(next);
  };

  const columns: WzReportColumn<ActivityRow>[] = [
    {
      id: "time",
      label: "Time",
      sortable: true,
      cell: (r) => <span className="block truncate">{activityTime(r.timestamp)}</span>,
    },
    {
      id: "user",
      label: "User",
      cell: (r) => (
        <div className="flex">
          <span className="shrink-0">{activityUser(r, directoryName)}</span>
          {r.doneByAI ? (
            <span role="img" aria-label="Done by AI" title="Done by AI" className="ml-1.5 inline-flex shrink-0">
              <Sparkles className="size-3.5 text-brand" aria-hidden />
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "action",
      label: "Action",
      // Workiz's cell is a flex row: the words never shrink, so a long one
      // runs to the cell's edge and pushes the device mark out of sight.
      cell: (r) => (
        <div className="flex h-[18px]">
          <span className="shrink-0">{r.text}</span>
          <ActivityDeviceIcon source={r.source} />
        </div>
      ),
    },
    {
      id: "job",
      label: "Job Id",
      cell: (r) =>
        r.dealId && r.jobRef ? (
          <Link href={`/deals/${r.dealId}`} className="text-foreground no-underline hover:underline">
            {r.jobRef}
          </Link>
        ) : (
          (r.jobRef ?? "")
        ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="activity-report">
      {/* The top band (rep_activity_wz_06_yesterday): the filter 34px under
          the breadcrumbs, 21px in, to 20px short of the date box; the box
          20px off the right edge; 30px under it to the strip. z-20 lets the
          date list hang over the strip and the grid's sticky header. */}
      <div className="relative z-20 flex shrink-0 items-start gap-5 pt-[34px] pr-5 pb-[30px] pl-[21px]">
        <WzGroupedFilter<TeamKey>
          className="min-w-0 flex-1"
          groups={groups}
          value={team}
          onChange={changeTeam}
          placeholder="Filter results"
        />
        <WzDateRangePicker
          presets={PRESETS}
          value={range}
          onChange={setRange}
          rangeOf={(id) => reportPresetRange(id as ReportPreset, today)}
          rangeText={(v) => (v.preset === "all_time" ? REPORT_PRESET_LABEL.all_time : undefined)}
          calendar={{ today }}
        />
      </div>

      <WzListToolbar className="gap-x-4">
        <WzSearchBox value={search} onChange={setSearch} />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect value={pageSize} sizes={ACTIVITY_PAGE_SIZES} onChange={setPageSize} />
          <WzToolbarButton onClick={() => void onExport()} disabled={exporting}>
            <FileText strokeWidth={1.5} /> {exporting ? "Exporting…" : "Export"}
          </WzToolbarButton>
        </div>
      </WzListToolbar>

      <div className="flex-1">
        {list.error ? (
          <p role="alert" className="px-5 py-4 text-sm text-destructive">
            {getApiErrorMessage(list.error)}
          </p>
        ) : (
          <TooltipProvider>
            <WzReportGrid
              aria-label="Activity"
              columns={columns}
              rows={ready ? pager.items : []}
              rowKey={(r) => r.id}
              sort={sort ? { column: "time", dir: sort } : null}
              onSort={() => setSort((s) => wzNextSort(s ?? undefined))}
              loading={!ready}
              busy={pager.isStale}
              // A searched walk may stop on its read budget with nothing yet — ours, not Workiz's.
              emptyText={list.hasNextPage ? "Nothing yet — keep going with the next page." : "No Records Found"}
              // Inside the frame, right under the rows (rep_activity_wz_06: pagination-bottom).
              footer={ready ? <WzPager pager={pager} plainNumbers /> : null}
            />
          </TooltipProvider>
        )}
      </div>
    </div>
  );
}
