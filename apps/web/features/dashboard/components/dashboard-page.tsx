"use client";

import { useState, type ComponentType } from "react";
import { Check, Settings } from "lucide-react";
import type { Action } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzDrawer } from "@/components/workiz/drawer";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDashboardBundle } from "../hooks";
import { readHidden, writeHidden } from "../hidden-widgets";
import {
  ComingUpCard,
  DispatchScoreboardCard,
  EstimatesCard,
  InvoicesCard,
  JobsNowCard,
  RecentActivityCard,
  RecentCallsCard,
  SalesCard,
  ServiceAreasCard,
  TechScoreboardCard,
  TodayCard,
  TopCallFlowsCard,
  TopJobTypesCard,
  TopSourcesCard,
  type CardProps,
} from "./dashboard-widgets";
import { JobsByStatusCard } from "./jobs-by-status-card";

interface Widget {
  key: string;
  /** What the "Dashboard widgets" panel calls it. */
  title: string;
  /** Its span of the four columns. */
  wide: boolean;
  Card: ComponentType<CardProps>;
}

/**
 * Workiz Home's widgets in its order — the order of its "Dashboard widgets"
 * panel and of the grid. Workiz's Payouts (Workiz Pay balance), Leads and
 * Expenses (Workiz Card) have no data here and are left out; the grid flows
 * on as Workiz's does when a widget is removed.
 */
const WIDGETS: Widget[] = [
  { key: "top-sources", title: "Top Sources", wide: false, Card: TopSourcesCard },
  { key: "jobs-by-status", title: "Jobs By Status", wide: true, Card: JobsByStatusCard },
  { key: "invoices", title: "Invoices", wide: false, Card: InvoicesCard },
  { key: "sales", title: "Sales", wide: true, Card: SalesCard },
  { key: "top-job-types", title: "Top Job Types", wide: false, Card: TopJobTypesCard },
  { key: "estimates", title: "Estimates", wide: false, Card: EstimatesCard },
  { key: "coming-up", title: "Coming up", wide: false, Card: ComingUpCard },
  { key: "service-areas", title: "Service Areas", wide: false, Card: ServiceAreasCard },
  { key: "top-call-flows", title: "Top Call Flows", wide: true, Card: TopCallFlowsCard },
  { key: "recent-activity", title: "Recent Activity", wide: false, Card: RecentActivityCard },
  { key: "dispatch-scoreboard", title: "Dispatch Scoreboard", wide: true, Card: DispatchScoreboardCard },
  { key: "recent-calls", title: "Recent Calls", wide: true, Card: RecentCallsCard },
  { key: "tech-scoreboard", title: "Tech Scoreboard", wide: true, Card: TechScoreboardCard },
  { key: "jobs-now", title: "Jobs", wide: false, Card: JobsNowCard },
  { key: "today", title: "Today", wide: false, Card: TodayCard },
];

/**
 * Workiz's grid (pg_dashboard_wz_home): four 316px columns 31px apart, rows
 * of 350px cards 25px apart, 20px in from either side, on #fafcfc. Two
 * columns on a tablet, one on a phone; a wide card spans two where there are.
 */
const GRID = "grid grid-cols-1 gap-x-[31px] gap-y-[25px] md:grid-cols-2 xl:grid-cols-4";
const WIDE = "md:col-span-2";
/** The cards start 85px under the breadcrumb strip; the gear tab sits in that band. */
const PAGE = "relative min-h-full flex-1 bg-wz-band px-5 pt-[85px] pb-[25px]";

/**
 * The dashboard while it loads: one grey card for each widget, in place. The
 * same one stands while the role is read (`/`) and while the opening bundle is
 * on its way, so the page goes from it to the filled cards once.
 */
export function DashboardSkeleton() {
  return (
    <div className={PAGE} role="status" aria-label="Loading the dashboard">
      <div className={GRID}>
        {WIDGETS.map((w) => (
          <Skeleton key={w.key} className={cn("h-[350px] rounded-[8px]", w.wide && WIDE)} />
        ))}
      </div>
    </div>
  );
}

/**
 * Workiz's dashboard settings tab: a slate 60×39 tab against the right edge
 * (20px corners on its left), a white gear.
 */
function SettingsTab({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Dashboard widgets"
      onClick={onOpen}
      className="absolute top-[19px] right-0 flex h-[39px] w-[60px] items-center rounded-l-[20px] bg-wz-tab-bar pl-[22px] text-white shadow-[0_2px_14px_rgba(0,0,0,0.04)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Settings className="size-[18px]" strokeWidth={1.75} />
    </button>
  );
}

/**
 * The "Dashboard widgets" panel (pg_dashboard_wz_settings_open): a 320px
 * drawer, one row per widget the role may see — Workiz's dark 24px box with a
 * white tick, the name 14px/500 #404040, rows 41px apart.
 */
function WidgetsPanel({
  open,
  onOpenChange,
  widgets,
  hidden,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgets: Widget[];
  hidden: string[];
  onToggle: (key: string, shown: boolean) => void;
}) {
  return (
    <WzDrawer open={open} onOpenChange={onOpenChange} title="Dashboard widgets" head="band" width={320} bodyClassName="px-5 pt-[28px]">
      <ul className="flex flex-col gap-[17px]">
        {widgets.map((w) => {
          const shown = !hidden.includes(w.key);
          return (
            <li key={w.key}>
              <label className="flex h-6 cursor-pointer items-center gap-[11px] text-sm leading-6 font-medium text-wz-strong">
                <span className="relative size-6 shrink-0">
                  <input
                    type="checkbox"
                    checked={shown}
                    onChange={(e) => onToggle(w.key, e.target.checked)}
                    className="peer size-6 cursor-pointer appearance-none rounded-[4px] border-2 border-foreground bg-white outline-none checked:bg-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Check
                    aria-hidden
                    className="pointer-events-none absolute inset-1 hidden size-4 text-white peer-checked:block"
                    strokeWidth={3}
                  />
                </span>
                {w.title}
              </label>
            </li>
          );
        })}
      </ul>
    </WzDrawer>
  );
}

/** Which widget each grant opens, and what else its data endpoint needs. */
function useOffered(): Widget[] {
  const { can } = usePermissions();
  const sees = (action: Action<"dashboard">) => can("dashboard", action);
  // A widget the reader may not see is not rendered at all — not greyed out.
  // Its data endpoint refuses them too, so a card here would only ever show
  // an error where a card has no business being.
  const allowed: Record<string, boolean> = {
    "top-sources": sees("view_top_sources"),
    "jobs-by-status": sees("view_jobs_by_status"),
    invoices: sees("view_invoices") && can("invoices", "view"),
    // "Sales" is nothing but money, so it also needs financials.view, which its endpoint checks as well.
    sales: sees("view_sales") && can("financials", "view"),
    "top-job-types": sees("view_top_job_types"),
    estimates: sees("view_estimates") && can("estimates", "view"),
    "coming-up": sees("view_coming_up") && can("deals", "view"),
    "service-areas": sees("view_service_areas"),
    "top-call-flows": sees("view_top_call_flows"),
    "recent-activity": sees("view_recent_activity") && can("reports", "view"),
    "dispatch-scoreboard": sees("view_dispatch_scoreboard"),
    "recent-calls": sees("view_recent_calls"),
    "tech-scoreboard": sees("view_tech_scoreboard"),
    "jobs-now": sees("view_jobs"),
    today: sees("view_today"),
  };
  return WIDGETS.filter((w) => allowed[w.key]);
}

/**
 * The office dashboard, as Workiz Home: the widgets the role may see, minus
 * the ones this person took off (kebab → Remove, or the gear's panel), in
 * Workiz's order on its grid.
 */
export function DashboardPage() {
  const { can, me } = usePermissions();
  const userId = me?.id ?? "anon";
  const offered = useOffered();
  const [hidden, setHidden] = useState<string[]>(() => readHidden(userId));
  const [panel, setPanel] = useState(false);
  const shown = offered.filter((w) => !hidden.includes(w.key));
  const on = (key: string) => shown.some((w) => w.key === key);

  const setShown = (key: string, visible: boolean) => {
    const next = visible ? hidden.filter((k) => k !== key) : [...new Set([...hidden, key])];
    setHidden(next);
    writeHidden(userId, next);
  };

  // One read per service, and one per other widget on show, laid into each
  // card's own cache entry. The cards are not drawn until it has settled:
  // drawn earlier, each stood around a grey bar of a guessed height and every
  // row moved the rows under it as the bodies filled. Now they come in one
  // frame, filled. If a part fails, its cards fetch on their own.
  const [now] = useState(() => new Date());
  const bundle = useDashboardBundle(now, {
    invoices: on("invoices"),
    estimates: on("estimates"),
    comingUp: on("coming-up"),
    recentActivity: on("recent-activity"),
    collected: on("today") && can("financials", "view") && can("payments", "view"),
  });
  const ready = usePageReady(settled(bundle));

  if (shown.length && !ready) return <DashboardSkeleton />;

  return (
    <div className={PAGE}>
      {offered.length ? <SettingsTab onOpen={() => setPanel(true)} /> : null}
      {shown.length ? (
        <div className={GRID}>
          {shown.map(({ key, wide, Card }) => (
            <Card key={key} className={cn(wide && WIDE)} onRemove={() => setShown(key, false)} />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-sm text-wz-dash-label">
          {offered.length
            ? "Every widget is off your dashboard. Bring them back from the Dashboard widgets panel."
            : "No widgets are shared with your role yet."}
        </p>
      )}
      <WidgetsPanel open={panel} onOpenChange={setPanel} widgets={offered} hidden={hidden} onToggle={setShown} />
    </div>
  );
}
