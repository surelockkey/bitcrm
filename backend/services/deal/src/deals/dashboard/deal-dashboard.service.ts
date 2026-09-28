import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  DashboardJobsNow,
  DashboardSales,
  DashboardScoreboard,
  DashboardShares,
  DashboardToday,
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

/** The same ceiling as every report window; the widgets offer at most thirty days. */
const WINDOW_MAX_DAYS = 92;
/** As long as the other dashboard counts are held. */
const AGGREGATE_TTL_SECONDS = 30;

export type ShareDimension = 'source' | 'jobType' | 'serviceArea';
export type ScoreboardKind = 'tech' | 'dispatch';

interface DayWindow {
  from: string;
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
 * counts Done jobs by the day they **closed** (a sale is a Done job). The
 * aggregate for each is cached for thirty seconds, since five widgets on one
 * page ask for the same window.
 */
@Injectable()
export class DealDashboardService {
  constructor(
    private readonly deals: DealsService,
    private readonly cache: DealsCacheService,
    private readonly jobTypes: JobTypesService,
    private readonly jobSources: JobSourcesService,
    private readonly http: InternalHttpService,
  ) {}

  async shares(dimension: ShareDimension, window: DayWindow, caller: JwtUser): Promise<DashboardShares> {
    const stats = await this.aggregate('created', checked(window), caller, false);
    if (dimension === 'serviceArea') return { slices: topShares(stats.byServiceArea, {}) };
    if (dimension === 'jobType') {
      const names = Object.fromEntries((await this.jobTypes.list()).map((t) => [t.id, t.name]));
      return { slices: topShares(stats.byJobType, names) };
    }
    const names = Object.fromEntries((await this.jobSources.list()).map((s) => [s.id, s.name]));
    return { slices: topShares(stats.bySource, names) };
  }

  /** Only ever called with `financials.view` — the route refuses anyone else. */
  async sales(window: DayWindow, caller: JwtUser): Promise<DashboardSales> {
    return salesOf(await this.aggregate('closed', checked(window), caller, true));
  }

  async scoreboard(
    kind: ScoreboardKind,
    window: DayWindow,
    caller: JwtUser,
    money: boolean,
  ): Promise<DashboardScoreboard> {
    const stats = await this.aggregate('closed', checked(window), caller, money);
    const buckets = kind === 'tech' ? stats.byTech : stats.byCreator;
    const ranked = scoreboardOf(buckets, {}, money);
    // Named after ranking: only the people on the board are looked up, not
    // everyone who closed something in the window.
    const people = await this.http.getUserNames(ranked.map((r) => r.id));
    const names = Object.fromEntries(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));
    return { rows: ranked.map((r) => ({ ...r, name: names[r.id] ?? r.name })) };
  }

  async today(day: string, caller: JwtUser, money: boolean): Promise<DashboardToday> {
    const window = checked({ from: day, to: day });
    const [closed, created] = await Promise.all([
      this.aggregate('closed', window, caller, money),
      this.aggregate('created', window, caller, false),
    ]);
    return todayOf(closed, created);
  }

  /** Right now, not a window: the same counts the jobs board's tabs show. */
  async jobsNow(caller: JwtUser): Promise<DashboardJobsNow> {
    const counts = await this.deals.counts({} as ListDealsQueryDto, caller, 'all');
    return jobsNowOf(counts as unknown as Record<JobSuperStatus, number | null>);
  }

  private async aggregate(
    by: 'created' | 'closed',
    window: DayWindow,
    caller: JwtUser,
    money: boolean,
  ): Promise<DealStats> {
    // Money is in the key: an aggregate built for someone without
    // `financials.view` has no amounts, and one built with them must never
    // be handed to someone without.
    const key = `deal-dash:${by}:${window.from}:${window.to}:${money ? 'money' : 'counts'}`;
    const cached = await this.cache.getJson<DealStats>(key);
    if (cached) return cached;

    const query = { [`${by}From`]: window.from, [`${by}To`]: window.to } as unknown as ListDealsQueryDto;
    const stats = await this.deals.stats(query, caller, 'all', { money });
    await this.cache.setJson(key, stats, AGGREGATE_TTL_SECONDS);
    return stats;
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
