"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Laptop, Smartphone } from "lucide-react";
import {
  ESTIMATE_STATUS_LABELS,
  type DashboardPreset,
  type DashboardScoreRow,
  type DashboardShares,
  type EstimateStatus,
} from "@bitcrm/types";
import { WzWidgetBarChart, WzWidgetLineChart, WzWidgetPie } from "@/components/workiz/widget-charts";
import { WzChartLegend, WzRangeSelect, WzWidgetStat } from "@/components/workiz/widget";
import { usePermissions } from "@/features/auth/use-permissions";
import { formatMoney } from "@/features/deals/lib";
import { callParty, formatEndpoint, type CallRecord } from "@/features/calls/lib";
import { cn } from "@/lib/utils";
import * as api from "../api";
import { barPercent, scoreInitial } from "../charts";
import { fromNow, visitStart, visitStreet } from "../coming-up";
import {
  useCollectedToday,
  useComingUp,
  useEstimatesWidget,
  useInvoicesWidget,
  useJobsNow,
  useRangeWidget,
  useRecentActivity,
  useRecentCalls,
  useToday,
} from "../hooks";
import { localDay } from "../jobs-by-status";
import { DEFAULT_PRESET, INVOICE_RANGES, WIDGET_RANGES, rangeWindowOf, type InvoiceRange } from "../ranges";
import { DashboardCard } from "./dashboard-card";

export type CardProps = { className?: string; onRemove?: () => void };

/**
 * A widget's own range. `now` is frozen for the life of the card: it decides
 * the window, the window is the query key, and a clock read on every render
 * would refetch forever.
 */
function useRange() {
  const [now] = useState(() => new Date());
  const [range, setRange] = useState<DashboardPreset>(DEFAULT_PRESET);
  return { now, range, setRange, window: rangeWindowOf(range, now)! };
}

/** The account's day, frozen for the card's life (see `useRange`). */
function useDay(): [string, Date] {
  const [now] = useState(() => new Date());
  return [localDay(now), now];
}

/** Workiz's "No data to display" in a widget. */
function Empty({ children = "No data to display" }: { children?: string }) {
  return <p className="pt-[60px] text-center text-sm leading-[18px] text-wz-dash-label">{children}</p>;
}

const count = (n: number) => n.toLocaleString("en-US");

/* ------------------------------------------------------------------ the pies */

function SharesCard({
  className,
  onRemove,
  title,
  name,
  action,
  fetch,
}: CardProps & {
  title: string;
  name: string;
  action: string;
  fetch: (window: api.DayWindow, opts?: api.SnapshotRequest) => Promise<DashboardShares>;
}) {
  const { range, setRange, window } = useRange();
  const query = useRangeWidget(name, fetch, window);
  return (
    <DashboardCard className={className} onRemove={onRemove} title={title} action={action} query={query} stamped>
      {(data) => (
        <>
          <div className="flex justify-end">
            <WzRangeSelect label="Range" value={range} options={WIDGET_RANGES} onChange={setRange} />
          </div>
          <WzWidgetPie title={title} slices={data.slices} />
        </>
      )}
    </DashboardCard>
  );
}

export function TopSourcesCard(props: CardProps) {
  return <SharesCard {...props} title="Top Sources" name="top-sources" action="view_top_sources" fetch={api.getTopSources} />;
}

export function TopJobTypesCard(props: CardProps) {
  return (
    <SharesCard {...props} title="Top Job Types" name="top-job-types" action="view_top_job_types" fetch={api.getTopJobTypes} />
  );
}

export function ServiceAreasCard(props: CardProps) {
  return (
    <SharesCard {...props} title="Service Areas" name="service-areas" action="view_service_areas" fetch={api.getServiceAreas} />
  );
}

/* --------------------------------------------------------------------- sales */

const NET = "var(--wz-chart-done)";
const TOTAL = "var(--wz-chart-track)";

export function SalesCard({ className, onRemove }: CardProps) {
  const { range, setRange, window } = useRange();
  const query = useRangeWidget("sales", api.getSales, window);
  return (
    <DashboardCard
      className={className}
      onRemove={onRemove}
      title="Sales"
      help={
        "Shows total and net after tax and the cost of parts for a selected time range.\n" +
        "Sales are only jobs that are Done and have any sale amount"
      }
      action="view_sales"
      query={query}
      stamped
      viewAll={{ href: "/reports/job-statistics", underline: false }}
    >
      {(data) => (
        <>
          <div className="flex items-start justify-between gap-3">
            <WzChartLegend
              items={[
                { label: "Net", color: NET, value: formatMoney(data.net) },
                { label: "Total", color: TOTAL, value: formatMoney(data.total) },
              ]}
            />
            <WzRangeSelect label="Range" value={range} options={WIDGET_RANGES} onChange={setRange} />
          </div>
          <WzWidgetBarChart
            className="mt-[11px]"
            title="Sales per day"
            days={data.days.map((d) => d.date)}
            series={[
              { label: "Net", color: NET, values: data.days.map((d) => d.net) },
              { label: "Total", color: TOTAL, values: data.days.map((d) => d.total) },
            ]}
            format={formatMoney}
          />
        </>
      )}
    </DashboardCard>
  );
}

/* ------------------------------------------------------------------ invoices */

export function InvoicesCard({ className, onRemove }: CardProps) {
  const { can } = usePermissions();
  const money = can("financials", "view");
  const [now] = useState(() => new Date());
  const [range, setRange] = useState<InvoiceRange>("all_time");
  const query = useInvoicesWidget(rangeWindowOf(range, now));
  const card = (label: string, c: { count: number; amount: number }, rule: string) => (
    <WzWidgetStat
      layout="stacked"
      rule={rule}
      label={label}
      sub={money ? `${count(c.count)} Invoices` : undefined}
      value={money ? formatMoney(c.amount) : count(c.count)}
    />
  );
  return (
    <DashboardCard
      className={className}
      onRemove={onRemove}
      title="Invoices"
      help={"Due balances for generated invoices.\nPast due means the invoice's balance has not been paid on time."}
      action="view_invoices"
      query={query}
      viewAll={{ href: "/invoices" }}
    >
      {(data) => (
        <>
          <div className="flex justify-end">
            <WzRangeSelect label="Range" value={range} options={INVOICE_RANGES} onChange={setRange} />
          </div>
          <div className="ml-px flex flex-col gap-[27px]">
            {card("Due", data.due, "border-wz-stat-yellow")}
            {card("Past Due", data.overdue, "border-wz-chart-canceled")}
          </div>
        </>
      )}
    </DashboardCard>
  );
}

/* ----------------------------------------------------------------- estimates */

/** Workiz's four, in its order; Won and Archived have no row on the widget. */
const ESTIMATE_ROWS: EstimateStatus[] = ["unsent", "pending", "approved", "declined"];

export function EstimatesCard({ className, onRemove }: CardProps) {
  const { can } = usePermissions();
  const money = can("financials", "view");
  const query = useEstimatesWidget();
  return (
    <DashboardCard
      className={className}
      onRemove={onRemove}
      title="Estimates"
      help="Current status of estimates"
      action="view_estimates"
      query={query}
      viewAll={{ href: "/estimates" }}
    >
      {(data) => (
        <div className="flex flex-col gap-4">
          {ESTIMATE_ROWS.map((status) => {
            const c = data[status] ?? { count: 0, amount: 0 };
            return (
              <WzWidgetStat
                key={status}
                label={ESTIMATE_STATUS_LABELS[status]}
                sub={money ? `Worth ${formatMoney(c.amount)}` : undefined}
                value={count(c.count)}
              />
            );
          })}
        </div>
      )}
    </DashboardCard>
  );
}

/* ----------------------------------------------------------------- coming up */

export function ComingUpCard({ className, onRemove }: CardProps) {
  const [day, now] = useDay();
  const query = useComingUp(day);
  return (
    <DashboardCard
      className={className}
      onRemove={onRemove}
      title="Coming up"
      action="view_coming_up"
      query={query}
      viewAll={{ href: "/schedule" }}
    >
      {({ deals, clients }) =>
        !deals.length ? (
          <Empty>Nothing on your schedule</Empty>
        ) : (
          // Workiz's name block is 90px narrower than the row's *content*, so it overhangs the padding by 13px.
          <ul className="-mr-[13px] flex flex-col gap-4">
            {deals.map((d) => {
              const at = visitStart(d);
              const client = d.clientName
                ? `${d.clientName.firstName} ${d.clientName.lastName}`.trim()
                : clients[d.contactId] ?? "";
              return (
                <li key={d.id}>
                  <Link
                    href={`/deals/${d.id}`}
                    className="flex h-[39px] items-stretch text-wz-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="w-[90px] shrink-0 text-xs leading-[21px] tracking-[0.167857px]">
                      {at === undefined ? "" : fromNow(at - now.getTime())}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col border-l-2 border-wz-frame pl-[11px]">
                      <span className="truncate text-sm leading-[21px]">{client || `#${d.dealNumber ?? ""}`}</span>
                      <span className="truncate text-xs leading-[18px]">{visitStreet(d)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )
      }
    </DashboardCard>
  );
}

/* ----------------------------------------------------------- recent activity */

export function RecentActivityCard({ className, onRemove }: CardProps) {
  const [day, now] = useDay();
  const query = useRecentActivity(day);
  return (
    <DashboardCard
      className={className}
      onRemove={onRemove}
      title="Recent Activity"
      action="view_recent_activity"
      query={query}
      viewAll={{ href: "/reports/activity" }}
    >
      {(rows) =>
        !rows.length ? (
          <Empty />
        ) : (
          // The right column runs 17px past the body's edge, as Workiz's grid columns do.
          <ol className="relative -mr-[17px] flex flex-col gap-2">
            {/* Workiz's timeline: a dotted rule 3px left of the entries, a yellow dot at each. */}
            <span aria-hidden className="absolute top-1.5 bottom-0 -left-[3px] border-l border-dotted border-wz-dash-label" />
            {rows.map((r) => {
              const Device = r.source === "mobile" ? Smartphone : r.source === "web" ? Laptop : null;
              return (
                <li key={r.id} className="relative flex h-14 gap-1.5 pl-2.5">
                  <span aria-hidden className="absolute top-[5px] -left-[5px] size-[5px] rounded-full bg-wz-stat-yellow" />
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 flex items-center text-xs leading-[14px] font-normal text-wz-text">
                      <span className="truncate">{r.who}</span>
                      {Device ? <Device aria-label={r.source === "mobile" ? "Mobile app" : "Web app"} className="ml-2.5 size-3.5 shrink-0" strokeWidth={1.5} /> : null}
                    </h3>
                    <div className="truncate text-sm leading-[18px] text-wz-text" title={r.text}>
                      {r.text}
                    </div>
                  </div>
                  <div className="flex w-[88px] shrink-0 flex-col items-end">
                    {r.jobRef && r.dealId ? (
                      <Link href={`/deals/${r.dealId}`} className="mb-2.5 text-xs leading-[18px] text-wz-link underline hover:text-brand">
                        #{r.jobRef}
                      </Link>
                    ) : (
                      <span className="mb-2.5 h-[18px]" />
                    )}
                    <span className="text-xs leading-[11px] tracking-[0.167857px] whitespace-nowrap text-wz-dash-label">
                      {fromNow(Date.parse(r.timestamp) - now.getTime())}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )
      }
    </DashboardCard>
  );
}

/* ---------------------------------------------------------------- scoreboards */

/** Workiz shows four people. */
const BOARD_ROWS = 4;

function Scoreboard({ rows }: { rows: DashboardScoreRow[] }) {
  if (!rows.length) return <Empty />;
  const shown = rows.slice(0, BOARD_ROWS);
  // The bar is sales when the reader may see money, jobs when not — the same
  // measure the server ranked by.
  const measure = (r: DashboardScoreRow) => r.sales ?? r.jobs;
  const leader = Math.max(...shown.map(measure));
  return (
    <ol className="flex flex-col">
      {shown.map((r, i) => {
        const name = r.name || "Unknown user";
        return (
          <li key={r.id} className={cn("flex items-center py-4", i > 0 && "border-t border-muted")}>
            <span
              aria-hidden
              className="ml-[3px] flex size-[30px] shrink-0 items-center justify-center rounded-full bg-foreground text-sm leading-[31px] text-white"
            >
              {scoreInitial(r.name)}
            </span>
            <span className="ml-[31px] w-[182px] min-w-0 truncate px-[3px] text-sm leading-[18px] text-wz-text" title={name}>
              {name}
            </span>
            <span className="relative ml-[3px] h-5 w-[176px] shrink-0 overflow-hidden rounded-[11px] bg-wz-chart-track">
              <span
                data-testid="score-bar"
                className="absolute inset-y-0 left-0 rounded-[11px] bg-wz-stat-slate"
                style={{ width: `${barPercent(measure(r), leader)}%` }}
              />
              {r.sales !== undefined ? (
                <span className="absolute top-0 left-[17px] text-xs leading-5 tracking-[-0.072px] whitespace-nowrap text-white">
                  {formatMoney(r.sales)}
                </span>
              ) : null}
            </span>
            <span className="ml-auto text-sm leading-[18px] whitespace-nowrap text-wz-text">
              {r.jobs} {r.jobs === 1 ? "Job" : "Jobs"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ScoreboardCard({
  className,
  onRemove,
  title,
  name,
  action,
  fetch,
}: CardProps & {
  title: string;
  name: string;
  action: string;
  fetch: (window: api.DayWindow, opts?: api.SnapshotRequest) => Promise<{ rows: DashboardScoreRow[] }>;
}) {
  const { range, setRange, window } = useRange();
  const query = useRangeWidget(name, async (w, opts) => api.nameScoreboard(await fetch(w, opts)), window);
  return (
    <DashboardCard className={className} onRemove={onRemove} title={title} action={action} query={query} stamped>
      {(data) => (
        <>
          <div className="flex justify-end">
            <WzRangeSelect label="Range" value={range} options={WIDGET_RANGES} onChange={setRange} />
          </div>
          <Scoreboard rows={data.rows} />
        </>
      )}
    </DashboardCard>
  );
}

export function TechScoreboardCard(props: CardProps) {
  return (
    <ScoreboardCard
      {...props}
      title="Tech Scoreboard"
      name="tech-scoreboard"
      action="view_tech_scoreboard"
      fetch={api.getTechScoreboard}
    />
  );
}

export function DispatchScoreboardCard(props: CardProps) {
  return (
    <ScoreboardCard
      {...props}
      title="Dispatch Scoreboard"
      name="dispatch-scoreboard"
      action="view_dispatch_scoreboard"
      fetch={api.getDispatchScoreboard}
    />
  );
}

/* ----------------------------------------------------------- jobs and today */

export function JobsNowCard({ className, onRemove }: CardProps) {
  const query = useJobsNow();
  return (
    <DashboardCard
      className={className}
      onRemove={onRemove}
      title="Jobs"
      action="view_jobs"
      query={query}
      viewAll={{ href: "/deals" }}
    >
      {({ byStatus }) => (
        <div className="flex flex-col gap-4">
          <WzWidgetStat label="Submitted" value={count(byStatus.submitted)} rule="border-wz-stat-green" />
          <WzWidgetStat label="Pending" value={count(byStatus.pending)} rule="border-wz-stat-slate" />
          <WzWidgetStat label="In progress" value={count(byStatus.in_progress)} rule="border-wz-stat-yellow" />
          <WzWidgetStat
            label="done pending approval"
            value={count(byStatus.done_pending_approval)}
            rule="border-wz-chart-canceled"
          />
        </div>
      )}
    </DashboardCard>
  );
}

export function TodayCard({ className, onRemove }: CardProps) {
  const { can } = usePermissions();
  const [day] = useDay();
  const query = useToday(day);
  const mayCollected = can("financials", "view") && can("payments", "view");
  const collected = useCollectedToday(day, mayCollected);
  return (
    <DashboardCard className={className} onRemove={onRemove} title="Today" action="view_today" query={query}>
      {(data) => (
        <div className="flex flex-col gap-4">
          {/* The server leaves the amount out for a reader without
              financials.view; the row goes with it rather than reading $0. */}
          {data.sales !== undefined ? (
            <WzWidgetStat label="Sales" value={formatMoney(data.sales)} rule="border-wz-stat-green" />
          ) : null}
          {mayCollected && collected.data !== undefined ? (
            <WzWidgetStat label="Collected" value={formatMoney(collected.data)} rule="border-wz-stat-green" />
          ) : null}
          <WzWidgetStat label="Jobs Done" value={count(data.jobsDone)} rule="border-wz-stat-yellow" />
          <WzWidgetStat label="Jobs Canceled" value={count(data.jobsCanceled)} rule="border-wz-chart-canceled" />
          <WzWidgetStat label="Jobs Created" value={count(data.jobsCreated)} rule="border-wz-stat-slate" />
        </div>
      )}
    </DashboardCard>
  );
}

/* ------------------------------------------------------------------- calls */

/** Top Call Flows' line colours, in order. */
const FLOW_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--wz-series${n})`);

export function TopCallFlowsCard({ className, onRemove }: CardProps) {
  const { range, setRange, window } = useRange();
  const query = useRangeWidget("top-call-flows", api.getTopCallFlows, window);
  return (
    <DashboardCard
      className={className}
      onRemove={onRemove}
      title="Top Call Flows"
      action="view_top_call_flows"
      query={query}
      viewAll={{ href: "/reports/call-tracking" }}
    >
      {(data) => {
        const series = data.flows.map((f, i) => ({ label: f.name, color: FLOW_COLORS[i % FLOW_COLORS.length], values: f.counts }));
        return (
          <>
            <div className="flex items-start justify-between gap-3">
              <WzChartLegend
                className="h-[23px] flex-nowrap overflow-hidden [&_li]:max-w-[110px]"
                items={series.map((s) => ({ label: s.label, color: s.color }))}
              />
              <WzRangeSelect label="Range" value={range} options={WIDGET_RANGES} onChange={setRange} />
            </div>
            {series.length ? (
              <WzWidgetLineChart className="mt-[33px]" title="Calls per call flow" days={data.days} series={series} />
            ) : (
              <Empty />
            )}
          </>
        );
      }}
    </DashboardCard>
  );
}

const partyName = (call: CallRecord, side: "from" | "to"): string => {
  const party = callParty(call, side);
  return party.name ?? formatEndpoint(party.number);
};

/** A call that got through reads green, one that did not red (recent_calls icons). */
const MISSED = new Set(["busy", "no-answer", "failed", "canceled"]);

export function RecentCallsCard({ className, onRemove }: CardProps) {
  const query = useRecentCalls();
  const [now] = useState(() => Date.now());
  return (
    <DashboardCard
      className={className}
      onRemove={onRemove}
      title="Recent Calls"
      action="view_recent_calls"
      query={query}
      viewAll={{ href: "/calls" }}
    >
      {(calls) =>
        !calls.length ? (
          <Empty>No recent calls to display</Empty>
        ) : (
          <table className="w-full table-fixed text-sm leading-[18px] text-wz-text">
            <thead>
              <tr className="text-left">
                <th scope="col" className="w-[10%] pb-2.5 font-normal">
                  <span className="sr-only">Direction</span>
                </th>
                {["From", "To", "Call Flow", "Time"].map((h) => (
                  <th key={h} scope="col" className="w-[22.5%] px-[3px] pb-2.5 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const outbound = c.direction === "outbound";
                const Arrow = outbound ? ArrowUpRight : ArrowDownLeft;
                const missed = c.status ? MISSED.has(c.status) : false;
                return (
                  <tr key={c.callSid} className="border-t border-muted">
                    <td className="py-4 pl-[3px]">
                      <Arrow
                        // recent_calls: answered #87dcbf, missed #dd380d (sampled; no token, one-off).
                        className={cn("size-5", missed ? "text-[#dd380d]" : "text-[#87dcbf]")}
                        strokeWidth={2.25}
                        aria-label={`${outbound ? "Outbound" : "Inbound"}${missed ? ", missed" : ""}`}
                        role="img"
                      />
                    </td>
                    <td className="truncate px-[3px] py-4">
                      <Link href={`/calls/${c.callSid}`} className="hover:underline">
                        {partyName(c, "from")}
                      </Link>
                    </td>
                    <td className="truncate px-[3px] py-4">{partyName(c, "to")}</td>
                    <td className="truncate px-[3px] py-4">{c.flowName ?? ""}</td>
                    <td className="truncate px-[3px] py-4">
                      {c.startedAt ? fromNow(Date.parse(c.startedAt) - now) : ""}
                    </td>
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
