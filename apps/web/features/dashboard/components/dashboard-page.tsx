"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { CLOSED_SUPER_STATUSES, type DealStatsBucket } from "@bitcrm/types";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealsPage, useUserMap } from "@/features/deals/hooks";
import { formatSchedule } from "@/features/deals/lib";
import { personName } from "@/features/deals/person-name";
import { useJobTypes } from "@/features/job-types/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useCallsList } from "@/features/calls/hooks";
import { useCallStream } from "@/features/calls/use-call-stream";
import { counterparty, formatCallAgo, STATUS_LABEL } from "@/features/calls/lib";
import { useInvoiceSummary, useJobsNeedingInvoice } from "@/features/invoices/hooks";
import { useEstimateSummary } from "@/features/estimates/hooks";
import { ESTIMATE_STATUS_META } from "@/features/estimates/lib";
import { useDealStats } from "../hooks";
import {
  bucketLabel,
  compactMoney,
  DASHBOARD_PERIODS,
  DEFAULT_PERIOD,
  periodWindow,
  statusRows,
  type DashboardPeriod,
} from "../lib";
import { DailyChart } from "./daily-chart";

const LIST_ROWS = 6;

const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The office's overview (EPIC-03): a period of jobs at a glance, then the
 * work that needs someone — coming up, needing an invoice, the latest calls
 * — and the leaderboards. Every widget renders only for the permission
 * behind it, and every amount only with `financials.view` (the server leaves
 * them out too). Job figures refresh with the jobs live stream.
 */
export function DashboardPage({ today }: { today: string }) {
  const { can } = usePermissions();
  const [period, setPeriod] = useState<DashboardPeriod>(DEFAULT_PERIOD);
  const window = useMemo(() => periodWindow(period, today), [period, today]);
  const canJobs = can("deals");
  const money = can("financials");
  const stats = useDealStats(window, canJobs);
  const data = stats.data;

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Select value={period} onValueChange={(v) => setPeriod(v as DashboardPeriod)}>
          <SelectTrigger className="h-9 w-40" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DASHBOARD_PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {canJobs && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {money && data?.money && (
            <>
              <StatTile label="Total revenue" value={compactMoney(data.money.revenue)} />
              <StatTile label="Net profit" value={compactMoney(data.money.profit)} />
              <StatTile label="Avg sale" value={compactMoney(data.money.avgSale)} />
              <StatTile label="Avg per day" value={compactMoney(data.money.avgPerDay)} />
            </>
          )}
          <StatTile label="Total jobs" value={data ? data.jobs.total.toLocaleString("en-US") : undefined} />
          <StatTile
            label="Jobs done"
            value={data ? data.jobs.byStatus.done.toLocaleString("en-US") : undefined}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {canJobs && (
          <Widget title={money ? "Sales performance" : "Jobs per day"} className="lg:col-span-2">
            {data ? (
              <DailyChart
                title={money ? "Revenue per day" : "Jobs per day"}
                days={data.series.map((d) => ({ date: d.date, value: money ? (d.revenue ?? 0) : d.jobs }))}
                format={money ? compactMoney : (v) => v.toLocaleString("en-US")}
              />
            ) : (
              <Skeleton className="h-40" />
            )}
          </Widget>
        )}
        {canJobs && (
          <Widget title="Jobs overview">
            {data ? (
              <ul className="flex flex-col divide-y divide-border">
                {statusRows(data.jobs.byStatus).map((r) => (
                  <li key={r.status} className="flex items-center justify-between py-1.5">
                    <span>{r.label}</span>
                    <span className="tabular-nums font-medium">{r.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Skeleton className="h-40" />
            )}
          </Widget>
        )}

        {canJobs && <ComingUp today={today} />}
        {can("invoices") && <NeedInvoices />}
        {can("calls") && <RecentCalls />}

        {canJobs && data && <Scoreboards buckets={data} money={money} />}

        {can("invoices") && <InvoicesWidget money={money} />}
        {can("estimates") && <EstimatesWidget money={money} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- building blocks */

function StatTile({ label, value }: { label: string; value?: string }) {
  return (
    <Card size="sm" className="px-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        {value === undefined ? <Skeleton className="h-7 w-20" /> : <span className="text-2xl font-semibold">{value}</span>}
      </div>
    </Card>
  );
}

function Widget({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  const id = `widget-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <Card className={className}>
      <section aria-labelledby={id} className="flex flex-col gap-3 px-4">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {children}
      </section>
    </Card>
  );
}

const Empty = ({ children = "No data to display." }: { children?: ReactNode }) => (
  <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
);

/** A leaderboard: name, jobs, and the amount when it may be shown, with a bar for scale. */
function RankedList({
  title,
  rows,
  names,
  money,
}: {
  title: string;
  rows: DealStatsBucket[];
  names: Record<string, string | undefined>;
  money: boolean;
}) {
  const top = rows.slice(0, LIST_ROWS);
  const max = Math.max(1, ...top.map((r) => (money ? (r.revenue ?? 0) : r.jobs)));
  return (
    <Widget title={title}>
      {top.length === 0 ? (
        <Empty />
      ) : (
        <ul className="flex flex-col gap-2">
          {top.map((r) => {
            const value = money ? (r.revenue ?? 0) : r.jobs;
            return (
              <li key={r.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate">{bucketLabel(r.key, names)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {r.jobs} {r.jobs === 1 ? "job" : "jobs"}
                    {money && <span className="ml-2 font-medium text-foreground">{compactMoney(r.revenue ?? 0)}</span>}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(value / max) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}

/* ------------------------------------------------------------------- widgets */

function Scoreboards({
  buckets,
  money,
}: {
  buckets: { byTech: DealStatsBucket[]; byCreator: DealStatsBucket[]; byJobType: DealStatsBucket[]; bySource: DealStatsBucket[]; byServiceArea: DealStatsBucket[] };
  money: boolean;
}) {
  const people = useUserMap([...buckets.byTech, ...buckets.byCreator].map((b) => b.key));
  const jobTypes = useJobTypes();
  const sources = useJobSources();

  const personNames = useMemo(() => {
    const out: Record<string, string | undefined> = {};
    for (const [id, u] of people.map) out[id] = personName(u);
    return out;
  }, [people.map]);
  const typeNames = useMemo(
    () => Object.fromEntries((jobTypes.data ?? []).map((t) => [t.id, t.name])),
    [jobTypes.data],
  );
  const sourceNames = useMemo(
    () => Object.fromEntries((sources.data ?? []).map((s) => [s.id, s.name])),
    [sources.data],
  );

  return (
    <>
      <RankedList title="Tech scoreboard" rows={buckets.byTech} names={personNames} money={money} />
      <RankedList title="Dispatch scoreboard" rows={buckets.byCreator} names={personNames} money={money} />
      <RankedList title="Top job types" rows={buckets.byJobType} names={typeNames} money={money} />
      <RankedList title="Top sources" rows={buckets.bySource} names={sourceNames} money={money} />
      <RankedList title="Service areas" rows={buckets.byServiceArea} names={{}} money={money} />
    </>
  );
}

function ComingUp({ today }: { today: string }) {
  const page = useDealsPage({ scheduledFrom: today, scheduledTo: shift(today, 6), sort: "schedule", dir: "asc", limit: 20 });
  const deals = (page.data?.pages.flatMap((p) => p.data) ?? [])
    .filter((d) => !CLOSED_SUPER_STATUSES.has(d.superStatus))
    .slice(0, LIST_ROWS);
  return (
    <Widget title="Coming up">
      {page.isLoading ? (
        <Skeleton className="h-32" />
      ) : deals.length === 0 ? (
        <Empty>No upcoming jobs scheduled.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {deals.map((d) => (
            <li key={d.id} className="py-1.5">
              <Link href={`/deals/${d.id}`} className="flex justify-between gap-2 hover:underline">
                <span className="truncate">
                  #{d.dealNumber} · {d.address?.street ?? d.serviceArea}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatSchedule(d.scheduledDate, d.scheduledTimeSlot)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

function NeedInvoices() {
  const jobs = useJobsNeedingInvoice();
  const rows = (jobs.data ?? []).slice(0, LIST_ROWS);
  return (
    <Widget title="Need invoices">
      {rows.length === 0 ? (
        <Empty>Every finished job has its invoice.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((j) => (
            <li key={j.id} className="py-1.5">
              <Link href={`/deals/${j.id}`} className="flex justify-between gap-2 hover:underline">
                <span className="truncate">
                  #{j.dealNumber}
                  {j.clientName ? ` · ${j.clientName}` : ""}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {j.itemCount} {j.itemCount === 1 ? "item" : "items"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

function RecentCalls() {
  useCallStream(true);
  const calls = useCallsList({}, LIST_ROWS);
  const rows = (calls.data?.pages.flatMap((p) => p.data) ?? []).slice(0, LIST_ROWS);
  return (
    <Widget title="Recent calls">
      {calls.isLoading ? (
        <Skeleton className="h-32" />
      ) : rows.length === 0 ? (
        <Empty>No recent calls to display.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((c) => {
            const party = counterparty(c);
            return (
              <li key={c.callSid} className="py-1.5">
                <Link href={`/calls/${c.callSid}`} className="flex justify-between gap-2 hover:underline">
                  <span className="truncate">
                    {party.name ?? party.number ?? "Unknown"}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {c.direction === "inbound" ? "Inbound" : "Outbound"}
                      {c.status ? ` · ${STATUS_LABEL[c.status] ?? c.status}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatCallAgo(c.startedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Widget>
  );
}

function InvoicesWidget({ money }: { money: boolean }) {
  const summary = useInvoiceSummary().data;
  const rows = summary
    ? [
        { label: "Due", count: summary.dueCount, amount: summary.dueAmount },
        { label: "Overdue", count: summary.overdueCount, amount: summary.overdueAmount },
        { label: "Unsent", count: summary.unsentCount },
        { label: "Need invoice", count: summary.needsInvoiceCount },
      ]
    : [];
  return (
    <Widget title="Invoices">
      {!summary ? (
        <Skeleton className="h-24" />
      ) : (
        <StatusTable rows={rows} money={money} href="/invoices" />
      )}
    </Widget>
  );
}

function EstimatesWidget({ money }: { money: boolean }) {
  const summary = useEstimateSummary().data;
  const rows = summary
    ? (Object.keys(ESTIMATE_STATUS_META) as (keyof typeof ESTIMATE_STATUS_META)[]).map((s) => ({
        label: ESTIMATE_STATUS_META[s].label,
        count: summary[s]?.count ?? 0,
        amount: summary[s]?.amount ?? 0,
      }))
    : [];
  return (
    <Widget title="Estimates">
      {!summary ? <Skeleton className="h-24" /> : <StatusTable rows={rows} money={money} href="/estimates" />}
    </Widget>
  );
}

function StatusTable({
  rows,
  money,
  href,
}: {
  rows: { label: string; count: number; amount?: number }[];
  money: boolean;
  href: string;
}) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((r) => (
        <li key={r.label} className="py-1.5">
          <Link href={href} className="flex justify-between gap-2 hover:underline">
            <span>{r.label}</span>
            <span className="tabular-nums">
              <span className="font-medium">{r.count}</span>
              {money && r.amount !== undefined && (
                <span className="ml-2 text-xs text-muted-foreground">{compactMoney(r.amount)}</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
