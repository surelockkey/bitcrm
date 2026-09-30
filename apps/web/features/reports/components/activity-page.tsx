"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Download, Laptop, Smartphone, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  ACTIVITY_DEFAULT_PAGE_SIZE,
  ACTIVITY_MAX_USERS,
  ACTIVITY_PAGE_SIZES,
  UserStatus,
  type ActivityRow,
  type ActivitySort,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDenied } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useUserMap } from "@/features/deals/hooks";
import { personName } from "@/features/deals/person-name";
import { getApiErrorMessage } from "@/lib/api/errors";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePager } from "@/lib/paging/use-pager";
import { ACTIVITY_PRESETS, REPORT_PRESET_LABEL, reportPresetRange, type ReportPreset } from "../report-dates";
import { exportActivity, useActivity, useActivityCount } from "../activity/hooks";
import { activityCsv, activityTime, activityUser, type ActivityFilter } from "../activity/lib";

/** How long the search waits for the typing to stop. */
const SEARCH_DELAY_MS = 400;

/**
 * Workiz Reports → Activity: who did what, and when — newest first, today by
 * default. "Filter results" narrows to current teammates (Workiz's own filter
 * lists only them), the search matches the action and the Job Id, the Time
 * column turns the order round, and Export writes the four columns as CSV
 * (at most 10,000 rows, as Workiz). Pages walk the server's cursor.
 */
export function ActivityPage({ today }: { today: string }) {
  const denied = useDenied();
  const blocked = denied("reports", "view");

  const [preset, setPreset] = useState<ReportPreset>("today");
  const [custom, setCustom] = useState({ from: today, to: today });
  const [userIds, setUserIds] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<ActivitySort>("desc");
  const [pageSize, setPageSize] = useState<number>(ACTIVITY_DEFAULT_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(typed), SEARCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [typed]);

  const range = reportPresetRange(preset, today) ?? custom;
  const valid = !!range.from && !!range.to && range.from <= range.to;
  const filter: ActivityFilter = { from: range.from, to: range.to, userIds, q, sort };

  const list = useActivity(filter, pageSize, !blocked && valid);
  const count = useActivityCount(filter, !blocked && valid);
  const pager = usePager(pagedSource(list), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ ...filter, pageSize }),
  });

  const { map: userMap, users } = useUserMap();
  const directoryName = (id: string) => personName(userMap.get(id));
  const team = useMemo(
    () =>
      users
        .filter((u) => (u as { status?: string }).status !== UserStatus.INACTIVE)
        .map((u) => ({ id: u.id, name: personName(u) ?? u.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );

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

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Back to reports">
            <Link href="/reports">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold tracking-tight">Activity</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Date preset"
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
            value={preset}
            onChange={(e) => setPreset(e.target.value as ReportPreset)}
          >
            {ACTIVITY_PRESETS.map((p) => (
              <option key={p} value={p}>
                {REPORT_PRESET_LABEL[p]}
              </option>
            ))}
          </select>
          {preset === "custom" ? (
            <>
              <input
                type="date"
                aria-label="From"
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
              <input
                type="date"
                aria-label="To"
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </>
          ) : (
            <span className="text-sm text-muted-foreground tabular-nums">
              {range.from === range.to ? range.from : `${range.from} – ${range.to}`}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 p-6">
        <TeamFilter team={team} selected={userIds} onChange={setUserIds} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <input
            type="search"
            aria-label="Search"
            placeholder="Search"
            className="h-9 w-full max-w-sm rounded-md border bg-transparent px-3 text-sm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          <Button variant="outline" size="sm" onClick={onExport} disabled={exporting || !valid}>
            <Download className="size-4" /> {exporting ? "Exporting…" : "Export"}
          </Button>
        </div>

        {!valid ? (
          <p role="alert" className="text-sm text-destructive">
            Pick a start day on or before the end day.
          </p>
        ) : list.error ? (
          <p role="alert" className="text-sm text-destructive">
            {getApiErrorMessage(list.error)}
          </p>
        ) : (
          <>
            <div className={`overflow-x-auto rounded-md border ${pager.isStale ? "opacity-60" : ""}`}>
              <table aria-label="Activity" className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th scope="col" className="w-56 px-3 py-2 text-left font-medium" aria-sort={sort === "asc" ? "ascending" : "descending"}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:underline"
                        onClick={() => setSort((s) => (s === "desc" ? "asc" : "desc"))}
                      >
                        Time {sort === "desc" ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
                      </button>
                    </th>
                    <th scope="col" className="w-56 px-3 py-2 text-left font-medium">User</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Action</th>
                    <th scope="col" className="w-28 px-3 py-2 text-left font-medium">Job Id</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.isLoading && !pager.items.length ? (
                    Array.from({ length: 5 }, (_, i) => (
                      <tr key={i} className="border-t">
                        <td colSpan={4} className="px-3 py-2">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      </tr>
                    ))
                  ) : pager.items.length ? (
                    pager.items.map((r) => <ActivityLine key={r.id} row={r} user={activityUser(r, directoryName)} />)
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                        {list.hasNextPage ? "Nothing yet — keep going with the next page." : "No activity in this period."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="tabular-nums">
                Showing {pager.from} to {pager.to}
                {typeof pager.total === "number"
                  ? ` of ${pager.total.toLocaleString("en-US")}${pager.totalIsFloor ? "+" : ""} results`
                  : ""}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={!pager.canPrev} onClick={() => pager.prev()}>
                  <ChevronLeft />
                </Button>
                <span className="tabular-nums">
                  Page {pager.page}
                  {pager.totalPages === undefined ? "" : ` of ${pager.totalPages.toLocaleString("en-US")}${pager.totalPagesIsFloor ? "+" : ""}`}
                </span>
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
              <label className="flex items-center gap-2">
                Rows per page
                <select
                  aria-label="Rows per page"
                  className="h-8 rounded-md border bg-transparent px-1 text-xs"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                >
                  {ACTIVITY_PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ActivityLine({ row, user }: { row: ActivityRow; user: string }) {
  const mobile = row.source === "mobile";
  return (
    <tr className="border-t odd:bg-muted/40">
      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{activityTime(row.timestamp)}</td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1">
          {user}
          {row.doneByAI && (
            <span role="img" aria-label="Done by AI" title="Done by AI">
              <Sparkles className="size-3.5 text-brand" aria-hidden />
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-2">
          <span>{row.text}</span>
          {row.source && row.source !== "system" ? (
            <span role="img" aria-label={mobile ? "Mobile App" : "Web App"} title={mobile ? "Mobile App" : "Web App"}>
              {mobile ? (
                <Smartphone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : (
                <Laptop className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              )}
            </span>
          ) : null}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {row.dealId && row.jobRef ? (
          <Link href={`/deals/${row.dealId}`} className="text-brand hover:underline">
            {row.jobRef}
          </Link>
        ) : (
          (row.jobRef ?? "")
        )}
      </td>
    </tr>
  );
}

/**
 * Workiz's "Filter results": current teammates, several at once (the server
 * takes up to 20). A searchable checklist, the picks shown as chips.
 */
function TeamFilter({
  team,
  selected,
  onChange,
}: {
  team: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const names = new Map(team.map((t) => [t.id, t.name]));
  const shown = team.filter((t) => t.name.toLowerCase().includes(find.trim().toLowerCase()));
  const full = selected.length >= ACTIVITY_MAX_USERS;
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="relative">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1">
        {selected.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-xs">
            {names.get(id) ?? id}
            <button type="button" aria-label={`Remove ${names.get(id) ?? id}`} onClick={() => toggle(id)}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex-1 text-left text-sm text-muted-foreground"
          onClick={() => setOpen((o) => !o)}
        >
          {selected.length ? "" : "Filter results"}
        </button>
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-w-md rounded-md border bg-popover p-2 shadow-md">
          <input
            type="search"
            aria-label="Find a teammate"
            placeholder="Team"
            className="mb-2 h-8 w-full rounded-md border bg-transparent px-2 text-sm"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
          <ul role="listbox" aria-label="Team" aria-multiselectable className="max-h-64 overflow-y-auto">
            {shown.map((t) => {
              const on = selected.includes(t.id);
              return (
                <li key={t.id} role="option" aria-selected={on}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                    <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(t.id)} />
                    {t.name}
                  </label>
                </li>
              );
            })}
            {!shown.length && <li className="px-1 py-1 text-sm text-muted-foreground">No teammate by that name.</li>}
          </ul>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
