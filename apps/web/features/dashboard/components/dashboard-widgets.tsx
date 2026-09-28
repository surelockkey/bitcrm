"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { DashboardScoreRow, DashboardShares } from "@bitcrm/types";
import { formatMoney } from "@/features/deals/lib";
import { callParty, formatCallAgo, formatEndpoint, type CallRecord } from "@/features/calls/lib";
import { cn } from "@/lib/utils";
import * as api from "../api";
import { barPercent, scoreInitial } from "../charts";
import { useJobsNow, useRangeWidget, useRecentCalls, useToday } from "../hooks";
import { axisDayLabel, type DashboardRange } from "../jobs-by-status";
import { compactMoney } from "../lib";
import { DailyChart } from "./daily-chart";
import { DashboardCard } from "./dashboard-card";
import { LineChart } from "./line-chart";
import { SharePie } from "./share-pie";

type CardProps = { className?: string };

/**
 * A widget's own "Last N Days" window. `now` is frozen for the life of the
 * card: it decides the window, the window is the query key, and a clock read
 * on every render would refetch forever.
 */
function useRange(initial: DashboardRange = 14) {
  const [now] = useState(() => new Date());
  const [range, setRange] = useState<DashboardRange>(initial);
  return { now, range, setRange };
}

/* ------------------------------------------------------------------ the pies */

function SharesCard({
  className,
  title,
  name,
  action,
  help,
  fetch,
}: CardProps & {
  title: string;
  name: string;
  action: string;
  help: string;
  fetch: (window: api.DayWindow) => Promise<DashboardShares>;
}) {
  const { now, range, setRange } = useRange();
  const query = useRangeWidget(name, fetch, range, now);
  return (
    <DashboardCard
      className={className}
      title={title}
      help={help}
      action={action}
      query={query}
      range={range}
      onRangeChange={setRange}
      skeletonClassName="h-56"
    >
      {(data) => <SharePie title={title} slices={data.slices} />}
    </DashboardCard>
  );
}

export function TopSourcesCard({ className }: CardProps) {
  return (
    <SharesCard
      className={className}
      title="Top Sources"
      name="top-sources"
      action="view_top_sources"
      help="The four sources the most jobs came from, by the day the job was created. Percent is the share of the four."
      fetch={api.getTopSources}
    />
  );
}

export function TopJobTypesCard({ className }: CardProps) {
  return (
    <SharesCard
      className={className}
      title="Top Job Types"
      name="top-job-types"
      action="view_top_job_types"
      help="The four job types with the most jobs, by the day the job was created. Percent is the share of the four."
      fetch={api.getTopJobTypes}
    />
  );
}

export function ServiceAreasCard({ className }: CardProps) {
  return (
    <SharesCard
      className={className}
      title="Service Areas"
      name="service-areas"
      action="view_service_areas"
      help="The four service areas with the most jobs, by the day the job was created. Percent is the share of the four."
      fetch={api.getServiceAreas}
    />
  );
}

/* --------------------------------------------------------------------- sales */

/**
 * Net beside Total. Total is the context bar — a light neutral, as Workiz
 * draws it — and Net the series the eye should follow.
 */
const SALES_SERIES = [
  { label: "Net", className: "bg-chart3", key: "net" },
  { label: "Total", className: "bg-input", key: "total" },
] as const;

export function SalesCard({ className }: CardProps) {
  const { now, range, setRange } = useRange();
  const query = useRangeWidget("sales", api.getSales, range, now);
  return (
    <DashboardCard
      className={className}
      title="Sales"
      help="Done jobs by the day they closed. Total is what was billed, tax included; Net is what is left after tax and the cost of parts."
      action="view_sales"
      query={query}
      range={range}
      onRangeChange={setRange}
      viewAll="/reports/job-statistics"
      skeletonClassName="h-52"
    >
      {(data) => (
        <div className="flex flex-col gap-3">
          <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SALES_SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-full", s.className)} aria-hidden />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="tabular-nums text-foreground">{formatMoney(data[s.key])}</span>
              </li>
            ))}
          </ul>
          <DailyChart
            title="Sales per day"
            legend={false}
            days={data.days.map((d) => ({ date: d.date, values: SALES_SERIES.map((s) => d[s.key]) }))}
            series={SALES_SERIES.map((s) => ({ label: s.label, className: s.className }))}
            format={compactMoney}
            labelOf={axisDayLabel}
          />
        </div>
      )}
    </DashboardCard>
  );
}

/* ---------------------------------------------------------------- scoreboards */

function Scoreboard({ rows }: { rows: DashboardScoreRow[] }) {
  if (!rows.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No data to display.</p>;
  }
  // The bar is sales when the reader may see money, jobs when not — the same
  // measure the server ranked by.
  const measure = (r: DashboardScoreRow) => r.sales ?? r.jobs;
  const leader = Math.max(...rows.map(measure));
  return (
    <ol className="flex flex-col divide-y divide-border">
      {rows.map((r) => {
        const name = r.name || "Unknown user";
        return (
          <li key={r.id} className="flex items-center gap-3 py-2.5">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-medium text-background"
              aria-hidden
            >
              {scoreInitial(r.name)}
            </span>
            <span className="w-44 min-w-0 truncate text-sm" title={name}>
              {name}
            </span>
            <span className="h-2.5 min-w-12 flex-1 rounded-full bg-muted" aria-hidden>
              <span
                data-testid="score-bar"
                className="block h-full rounded-full bg-neutral"
                style={{ width: `${barPercent(measure(r), leader)}%` }}
              />
            </span>
            {r.sales !== undefined ? (
              <span className="w-28 shrink-0 text-right text-sm tabular-nums">{formatMoney(r.sales)}</span>
            ) : null}
            <span className="w-16 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
              {r.jobs} {r.jobs === 1 ? "Job" : "Jobs"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function TechScoreboardCard({ className }: CardProps) {
  const { now, range, setRange } = useRange();
  const query = useRangeWidget("tech-scoreboard", api.getTechScoreboard, range, now);
  return (
    <DashboardCard
      className={className}
      title="Tech Scoreboard"
      help="The technicians whose Done jobs sold the most, by the day the job closed. A job shared by techs counts for each and splits its money."
      action="view_tech_scoreboard"
      query={query}
      range={range}
      onRangeChange={setRange}
      skeletonClassName="h-52"
    >
      {(data) => <Scoreboard rows={data.rows} />}
    </DashboardCard>
  );
}

export function DispatchScoreboardCard({ className }: CardProps) {
  const { now, range, setRange } = useRange();
  const query = useRangeWidget("dispatch-scoreboard", api.getDispatchScoreboard, range, now);
  return (
    <DashboardCard
      className={className}
      title="Dispatch Scoreboard"
      help="The people whose jobs sold the most — the job's creator — counting Done jobs by the day they closed."
      action="view_dispatch_scoreboard"
      query={query}
      range={range}
      onRangeChange={setRange}
      skeletonClassName="h-52"
    >
      {(data) => <Scoreboard rows={data.rows} />}
    </DashboardCard>
  );
}

/* ----------------------------------------------------------- stat lists */

/** A figure with a coloured rule on its left, as Workiz's "Jobs" and "Today" draw them. */
function StatList({ rows }: { rows: { label: string; value: string; rule: string }[] }) {
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((r) => (
        <li key={r.label} className={cn("flex items-center justify-between gap-3 border-l-2 py-1 pl-3", r.rule)}>
          <span className="text-sm">{r.label}</span>
          <span className="text-3xl font-light tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

const count = (n: number) => n.toLocaleString("en-US");

export function JobsNowCard({ className }: CardProps) {
  const query = useJobsNow();
  return (
    <DashboardCard
      className={className}
      title="Jobs"
      help="How many jobs stand in each open state right now, across the account."
      action="view_jobs"
      query={query}
      viewAll="/deals"
    >
      {({ byStatus }) => (
        <StatList
          rows={[
            { label: "Submitted", value: count(byStatus.submitted), rule: "border-chart-good" },
            { label: "Pending", value: count(byStatus.pending), rule: "border-foreground" },
            { label: "In progress", value: count(byStatus.in_progress), rule: "border-chart-warning" },
            {
              label: "done pending approval",
              value: count(byStatus.done_pending_approval),
              rule: "border-chart-critical",
            },
          ]}
        />
      )}
    </DashboardCard>
  );
}

export function TodayCard({ className }: CardProps) {
  const [now] = useState(() => new Date());
  const query = useToday(now);
  return (
    <DashboardCard
      className={className}
      title="Today"
      help="Your calendar day so far: what the jobs finished today sold, how many were done or canceled, and how many were created."
      action="view_today"
      query={query}
    >
      {(data) => (
        <StatList
          rows={[
            // The server leaves the amount out for a reader without
            // financials.view; the row goes with it rather than reading $0.
            ...(data.sales !== undefined
              ? [{ label: "Sales", value: formatMoney(data.sales), rule: "border-chart-good" }]
              : []),
            { label: "Jobs Done", value: count(data.jobsDone), rule: "border-chart-warning" },
            { label: "Jobs Canceled", value: count(data.jobsCanceled), rule: "border-chart-critical" },
            { label: "Jobs Created", value: count(data.jobsCreated), rule: "border-foreground" },
          ]}
        />
      )}
    </DashboardCard>
  );
}

/* ------------------------------------------------------------------- calls */

export function TopCallFlowsCard({ className }: CardProps) {
  const { now, range, setRange } = useRange();
  const query = useRangeWidget("top-call-flows", api.getTopCallFlows, range, now);
  return (
    <DashboardCard
      className={className}
      title="Top Call Flows"
      help="Calls a day through each of the eight busiest call flows. Outbound calls never enter a flow and are not counted."
      action="view_top_call_flows"
      query={query}
      range={range}
      onRangeChange={setRange}
      viewAll="/calls"
      skeletonClassName="h-52"
    >
      {(data) => (
        <LineChart
          title="Calls per call flow"
          days={data.days}
          series={data.flows.map((f) => ({ name: f.name, values: f.counts }))}
          labelOf={axisDayLabel}
        />
      )}
    </DashboardCard>
  );
}

const partyName = (call: CallRecord, side: "from" | "to"): string => {
  const party = callParty(call, side);
  return party.name ?? formatEndpoint(party.number);
};

export function RecentCallsCard({ className }: CardProps) {
  const query = useRecentCalls();
  return (
    <DashboardCard
      className={className}
      title="Recent Calls"
      help="The four newest calls in the call log."
      action="view_recent_calls"
      query={query}
      viewAll="/calls"
    >
      {(calls) =>
        !calls.length ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No recent calls to display.</p>
        ) : (
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="w-10 pb-2">
                  <span className="sr-only">Direction</span>
                </th>
                <th scope="col" className="pb-2 font-normal">
                  From
                </th>
                <th scope="col" className="pb-2 font-normal">
                  To
                </th>
                <th scope="col" className="pb-2 font-normal">
                  Call Flow
                </th>
                <th scope="col" className="w-28 pb-2 font-normal">
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const outbound = c.direction === "outbound";
                const Arrow = outbound ? ArrowUpRight : ArrowDownLeft;
                return (
                  <tr key={c.callSid} className="border-b border-border last:border-0">
                    <td className="py-3">
                      <Arrow
                        className="size-5 text-success"
                        aria-label={outbound ? "Outbound" : "Inbound"}
                        role="img"
                      />
                    </td>
                    <td className="truncate py-3 pr-2">
                      <Link href={`/calls/${c.callSid}`} className="hover:underline">
                        {partyName(c, "from")}
                      </Link>
                    </td>
                    <td className="truncate py-3 pr-2">{partyName(c, "to")}</td>
                    <td className="truncate py-3 pr-2 text-muted-foreground">{c.flowName ?? ""}</td>
                    <td className="py-3 text-muted-foreground">{formatCallAgo(c.startedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      }
    </DashboardCard>
  );
}
