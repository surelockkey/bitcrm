import { BadRequestException, Injectable } from '@nestjs/common';
import { DASHBOARD_PRESETS, dashboardPresetWindow } from '@bitcrm/types';
import type {
  DashboardJobsNow,
  DashboardSales,
  DashboardScoreboard,
  DashboardShares,
  DashboardToday,
  DealDashboardBundle,
  DealStats,
  JobSuperStatus,
  JwtUser,
} from '@bitcrm/types';
import { DealsService } from '../deals.service';
import { DealsCacheService } from '../deals-cache.service';
import { JobTypesService } from '../../job-types/job-types.service';
import { JobSourcesService } from '../../job-sources/job-sources.service';
import { InternalHttpService } from '../../common/services/internal-http.service';
import type { ListDealsQueryDto } from '../dto/list-deals-query.dto';
import { jobsNowOf, salesOf, scoreboardOf, todayOf, topShares } from '../stats/dashboard-widgets';

/** The same ceiling as every report window; "Last 3 months" reaches exactly it. */
const WINDOW_MAX_DAYS = 92;
/**
 * A snapshot lives until the next nightly run replaces it, with slack for a
 * run that starts late. Past that it expires rather than be served forever.
 */
export const SNAPSHOT_TTL_SECONDS = 26 * 3600;

export type ShareDimension = 'source' | 'jobType' | 'serviceArea';
export type ScoreboardKind = 'tech' | 'dispatch';

interface DayWindow {
  from: string;
  to: string;
}

/** `fresh` rebuilds the snapshot instead of reading it — the card's refresh button. */
export interface SnapshotOptions {
  fresh?: boolean;
}

interface Snapshot {
  stats: DealStats;
  computedAt: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "Today" is the day so far, so it is read live rather than from a snapshot. */
const TODAY_TTL_SECONDS = 30;

/**
 * Who the nightly run reads as. The aggregate is always read under the `all`
 * scope, so the caller only has to be somebody; this one is never a person.
 */
const SYSTEM_CALLER = { id: 'system:dashboard-snapshot' } as JwtUser;

/**
 * The dashboard's job widgets. Each one is a slice of `/deals/stats` — the
 * aggregate Job Statistics reads — so the dashboard and the report cannot
 * disagree about a period.
 *
 * **The whole account, not the caller's rows.** A widget is shared with a role
 * or it is not (its route checks the grant); what it shows is the business,
 * the way Workiz's does. So the aggregate is asked for under the `all` scope.
 *
 * Two windows, because Workiz uses two: the pies count work by the day it was
 * **created** (where did the jobs come from), and anything with money in it
 * counts Done jobs by the day they **closed** (a sale is a Done job).
 *
 * **Snapshots, not live reads.** An aggregate is a read of every job in the
 * window, and nobody should watch that happen when they open the dashboard.
 * So each one is a snapshot: built ahead of time by the nightly run
 * (`warm`), kept until the next, and carrying the moment it was computed —
 * the "updated 3:00 AM" on the card, as in Workiz. A window nobody warmed is
 * built on first ask and kept the same way; the refresh button rebuilds it.
 */
@Injectable()
export class DealDashboardService {
  /**
   * Aggregates being built right now, by cache key. The bundle asks for one
   * window from several widgets at once; on a cold cache each would miss and
   * build the same aggregate — this makes them wait for the first instead.
   */
  private readonly building = new Map<string, Promise<Snapshot>>();

  constructor(
    private readonly deals: DealsService,
    private readonly cache: DealsCacheService,
    private readonly jobTypes: JobTypesService,
    private readonly jobSources: JobSourcesService,
    private readonly http: InternalHttpService,
  ) {}

  async shares(
    dimension: ShareDimension,
    window: DayWindow,
    caller: JwtUser,
    opts: SnapshotOptions = {},
  ): Promise<DashboardShares> {
    const { stats, computedAt } = await this.aggregate('created', checked(window), caller, false, opts);
    if (dimension === 'serviceArea') return { slices: topShares(stats.byServiceArea, {}), computedAt };
    if (dimension === 'jobType') {
      const names = Object.fromEntries((await this.jobTypes.list()).map((t) => [t.id, t.name]));
      return { slices: topShares(stats.byJobType, names), computedAt };
    }
    const names = Object.fromEntries((await this.jobSources.list()).map((s) => [s.id, s.name]));
    return { slices: topShares(stats.bySource, names), computedAt };
  }

  /** Only ever called with `financials.view` — the route refuses anyone else. */
  async sales(window: DayWindow, caller: JwtUser, opts: SnapshotOptions = {}): Promise<DashboardSales> {
    const { stats, computedAt } = await this.aggregate('closed', checked(window), caller, true, opts);
    return { ...salesOf(stats), computedAt };
  }

  async scoreboard(
    kind: ScoreboardKind,
    window: DayWindow,
    caller: JwtUser,
    money: boolean,
    opts: SnapshotOptions = {},
  ): Promise<DashboardScoreboard> {
    const { stats, computedAt } = await this.aggregate('closed', checked(window), caller, money, opts);
    const buckets = kind === 'tech' ? stats.byTech : stats.byCreator;
    const ranked = scoreboardOf(buckets, {}, money);
    // Named after ranking: only the people on the board are looked up, not
    // everyone who closed something in the window.
    const people = await this.http.getUserNames(ranked.map((r) => r.id));
    const names = Object.fromEntries(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));
    return { rows: ranked.map((r) => ({ ...r, name: names[r.id] ?? r.name })), computedAt };
  }

  async today(day: string, caller: JwtUser, money: boolean): Promise<DashboardToday> {
    const window = checked({ from: day, to: day });
    // Today is read live — thirty seconds, not a snapshot: its whole point is
    // the day so far, and one day of jobs is a small read.
    const [closed, created] = await Promise.all([
      this.aggregate('closed', window, caller, money, { ttlSeconds: TODAY_TTL_SECONDS }),
      this.aggregate('created', window, caller, false, { ttlSeconds: TODAY_TTL_SECONDS }),
    ]);
    return todayOf(closed.stats, created.stats);
  }

  /** Right now, not a window: the same counts the jobs board's tabs show. */
  async jobsNow(caller: JwtUser): Promise<DashboardJobsNow> {
    const counts = await this.deals.counts({} as ListDealsQueryDto, caller, 'all');
    return jobsNowOf(counts as unknown as Record<JobSuperStatus, number | null>);
  }

  /**
   * Everything the dashboard opens with, in one answer: each deal widget the
   * caller holds the grant for, on the opening window. Built from the same
   * snapshots as the single routes, side by side, so the cards can paint
   * together instead of one by one as eleven answers trickle in.
   *
   * `may` is the caller's grant check for a widget action; Sales also needs
   * `money`, as its own route does.
   */
  async bundle(
    window: DayWindow,
    day: string,
    caller: JwtUser,
    may: (action: string) => boolean,
    money: boolean,
  ): Promise<DealDashboardBundle> {
    checked(window);
    const parts: [keyof DealDashboardBundle, () => Promise<unknown>][] = [];
    const add = (key: keyof DealDashboardBundle, allowed: boolean, load: () => Promise<unknown>) => {
      if (allowed) parts.push([key, load]);
    };
    add('sales', may('view_sales') && money, () => this.sales(window, caller));
    add('topSources', may('view_top_sources'), () => this.shares('source', window, caller));
    add('topJobTypes', may('view_top_job_types'), () => this.shares('jobType', window, caller));
    add('serviceAreas', may('view_service_areas'), () => this.shares('serviceArea', window, caller));
    add('techScoreboard', may('view_tech_scoreboard'), () => this.scoreboard('tech', window, caller, money));
    add('dispatchScoreboard', may('view_dispatch_scoreboard'), () =>
      this.scoreboard('dispatch', window, caller, money),
    );
    add('today', may('view_today'), () => this.today(day, caller, money));
    add('jobsNow', may('view_jobs'), () => this.jobsNow(caller));
    add('jobsByStatus', may('view_jobs_by_status'), () => this.deals.jobsByStatus(window));

    const values = await Promise.all(parts.map(([, load]) => load()));
    return Object.fromEntries(parts.map(([key], i) => [key, values[i]])) as DealDashboardBundle;
  }

  /**
   * The nightly run: every range the widgets offer, ending today in the
   * account's time zone, rebuilt for both windows and both audiences — plus
   * the Jobs By Status series. One at a time: it runs at 3 AM, and there is
   * no one to hurry for, only a table not to hammer.
   */
  async warm(now: Date, caller: JwtUser = SYSTEM_CALLER): Promise<void> {
    const fresh = { fresh: true };
    // Workiz's four ranges (this week, the 14 days, this month, the last three
    // months) — what the web's pickers offer. A preset that lands on the same
    // days as another (this week on a Monday is just today) is built once.
    const windows = [
      ...new Map(
        DASHBOARD_PRESETS.map((p) => dashboardPresetWindow(p, now)).map((w) => [`${w.from}:${w.to}`, w]),
      ).values(),
    ];
    for (const window of windows) {
      await this.aggregate('created', window, caller, false, fresh);
      await this.aggregate('closed', window, caller, true, fresh);
      await this.aggregate('closed', window, caller, false, fresh);
    }
    for (const window of windows) {
      await this.deals.jobsByStatus(window, fresh);
    }
  }

  private async aggregate(
    by: 'created' | 'closed',
    window: DayWindow,
    caller: JwtUser,
    money: boolean,
    opts: SnapshotOptions & { ttlSeconds?: number } = {},
  ): Promise<Snapshot> {
    // Money is in the key: an aggregate built for someone without
    // `financials.view` has no amounts, and one built with them must never
    // be handed to someone without.
    const key = `deal-dash:${by}:${window.from}:${window.to}:${money ? 'money' : 'counts'}`;
    if (!opts.fresh) {
      const cached = await this.cache.getJson<Snapshot>(key);
      // A value from before snapshots is a bare aggregate; rebuild it.
      if (cached?.stats && cached.computedAt) return cached;
    }

    const inFlight = this.building.get(key);
    if (inFlight) return inFlight;

    const build = (async () => {
      const query = { [`${by}From`]: window.from, [`${by}To`]: window.to } as unknown as ListDealsQueryDto;
      const stats = await this.deals.stats(query, caller, 'all', { money });
      const snapshot = { stats, computedAt: new Date().toISOString() };
      await this.cache.setJson(key, snapshot, opts.ttlSeconds ?? SNAPSHOT_TTL_SECONDS);
      return snapshot;
    })();
    this.building.set(key, build);
    try {
      return await build;
    } finally {
      this.building.delete(key);
    }
  }
}

/** A window of whole days, forwards, and no longer than a quarter. */
function checked(window: DayWindow): DayWindow {
  const { from, to } = window;
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    throw new BadRequestException('Days are YYYY-MM-DD');
  }
  if (to < from) throw new BadRequestException('The window must start on or before it ends');
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > WINDOW_MAX_DAYS) throw new BadRequestException(`The window is limited to ${WINDOW_MAX_DAYS} days`);
  return window;
}
