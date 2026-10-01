import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  JOB_STATISTICS_PROFIT_ACTION,
  JOB_STATISTICS_TABS,
  JOB_STATISTICS_TAB_ACTION,
  JobSuperStatus,
  type JobStatistics,
  type JobStatisticsBy,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { hasPermission } from '@bitcrm/shared';
import { DealsRepository } from '../deals.repository';
import { CommissionReportService } from '../../commission-report/commission-report.service';
import type { CommissionDealItem } from '../../commission-report/commission-report.types';
import { JobsReportService, windowReadError, type ReportCaller } from './jobs-report.service';
import { parseJobsReportQuery, type JobsReportQueryDto } from './jobs-report.query';
import { inWindow, isReportable, matchesFilters } from './jobs-report.logic';
import {
  STATS_PROJECTION,
  aggregateJobStatistics,
  toStatsDeal,
  type StatsDeal,
  type StatsLookups,
  type StatsOptions,
} from './job-statistics.logic';

/** A window is read once and kept a minute per (date, days) — switching tabs or filters does not read it again. */
const WINDOW_TTL_MS = 60_000;
const WINDOW_CACHE_MAX = 3;

interface StatsWindow {
  deals: StatsDeal[];
  /** What the profit of the jobs done here could not include. */
  warnings: string[];
}

/**
 * What a caller may see. A Job Statistics tab (and View Profit) closes only
 * on an explicit `false`: a role saved before these grants existed keeps
 * every tab it had, and system roles get them from the boot-time reconcile.
 */
export function statisticsAccess(perms?: ResolvedPermissions): StatsOptions {
  const superAdmin = perms?.isSystemRole === true && perms.roleName === 'Super Admin';
  const granted = (action: string | undefined): boolean =>
    !action || superAdmin || perms?.permissions?.reports?.[action] !== false;
  const money = hasPermission(perms, 'financials', 'view');
  return {
    money,
    profit: money && granted(JOB_STATISTICS_PROFIT_ACTION),
    tabs: JOB_STATISTICS_TABS.filter((tab) => granted(JOB_STATISTICS_TAB_ACTION[tab])),
  };
}

/**
 * The Workiz Job Statistics report (`GET /deals/report/statistics`).
 *
 * Reads the period off the index of its date exactly as the Jobs report does
 * (`DealsRepository.readReportWindow`, the account calendar of
 * `report-dates.ts`), with the money attributes on top; filters and scopes it
 * with the Jobs report's own functions; aggregates it with the pure
 * `job-statistics.logic.ts`.
 *
 * Profit is the company's after the technician's share — the Company Profit
 * of Commissions (Legacy). An imported job carries Workiz's own figure; for a
 * job done here the Commissions report builds its row (its ledger, the
 * technician's rate in force on its day, its parts) and that row's Company
 * Profit is taken, so the two reports can never disagree.
 */
@Injectable()
export class JobStatisticsService {
  private readonly logger = new Logger(JobStatisticsService.name);
  private readonly windows = new Map<string, { at: number; read: Promise<StatsWindow> }>();

  constructor(
    private readonly repository: DealsRepository,
    private readonly jobsReport: JobsReportService,
    @Optional() private readonly commissions?: CommissionReportService,
  ) {}

  async statistics(dto: JobsReportQueryDto, caller: ReportCaller): Promise<JobStatistics> {
    const q = parseJobsReportQuery(dto);
    // Workiz opens on "Closed" — the visit's end.
    const by: JobStatisticsBy = q.by ?? 'end';
    const access = statisticsAccess(caller.perms);
    const window = await this.window(by, q.from, q.to);
    // `assigned_only` sees the jobs it is on — as the jobs list and the Jobs report do.
    const own = caller.perms?.dataScope?.deals === 'assigned_only' ? caller.user.id : undefined;
    const kept = window.deals.filter(
      (d) => inWindow(d, by, q.from, q.to) && (!own || d.techIds.includes(own)) && matchesFilters(d, q.filters),
    );
    const lookups = await this.lookups(kept, access);
    const stats = aggregateJobStatistics(kept, { by, from: q.from, to: q.to }, lookups, access);
    return {
      ...stats,
      access: { money: access.money, profit: access.profit, tabs: [...access.tabs] },
      // The warnings are about the profit of jobs done here — only for those who see profit and have such jobs.
      warnings: access.profit && kept.some((d) => d.superStatus === JobSuperStatus.DONE && d.profitSource !== 'workiz') ? window.warnings : [],
    };
  }

  /* -------------------------------------------------------------- window */

  private window(by: JobStatisticsBy, from: string, to: string): Promise<StatsWindow> {
    const key = `${by}|${from}|${to}`;
    const now = Date.now();
    const hit = this.windows.get(key);
    if (hit && now - hit.at < WINDOW_TTL_MS) return hit.read;

    const read = this.repository
      .readReportWindow(by, from, to, STATS_PROJECTION)
      .then((items) => items.map(toStatsDeal).filter((d) => isReportable(d) && inWindow(d, by, from, to)))
      .then((deals) => this.withProfit(deals))
      .catch((err: unknown) => {
        this.windows.delete(key);
        throw windowReadError(err, by, this.logger, 'Job Statistics');
      });
    this.windows.delete(key);
    this.windows.set(key, { at: now, read });
    for (const [k, v] of this.windows) {
      if (this.windows.size <= WINDOW_CACHE_MAX && now - v.at < WINDOW_TTL_MS) break;
      this.windows.delete(k);
    }
    return read;
  }

  /**
   * The profit of the Done jobs that Workiz never priced (done in BitCRM):
   * their Commissions (Legacy) rows, built by that report, Company Profit
   * and parts taken from them. A job whose row cannot be built counts no
   * profit, and the answer says so.
   */
  private async withProfit(deals: StatsDeal[]): Promise<StatsWindow> {
    const pending = deals.filter((d) => d.pending);
    if (!pending.length) return { deals, warnings: [] };
    const warnings: string[] = [];
    try {
      if (!this.commissions) throw new Error('the commissions report is not wired');
      const built = await this.commissions.build(pending.map((d) => d.pending as unknown as CommissionDealItem));
      warnings.push(...built.warnings);
      const rows = new Map(built.rows.map((r) => [r.dealId, r]));
      for (const d of pending) {
        const r = rows.get(d.id);
        if (!r) continue;
        d.profit = r.companyProfit;
        d.profitSource = 'computed';
        d.parts = r.parts;
      }
    } catch (err) {
      this.logger.warn(`Job Statistics: profit of ${pending.length} job(s) done in BitCRM not computed: ${(err as Error).message}`);
    }
    const missing = pending.filter((d) => d.profitSource !== 'computed').length;
    if (missing) warnings.push(`The profit of ${missing} job(s) done in BitCRM could not be computed — they count no profit.`);
    for (const d of pending) delete d.pending;
    return { deals, warnings };
  }

  /* --------------------------------------------------------------- names */

  /** Names for the rows: the Jobs report's catalogs and its cached user names — only those a visible tab prints. */
  private async lookups(deals: StatsDeal[], access: StatsOptions): Promise<StatsLookups> {
    const tabs = new Set(access.tabs);
    const catalogs = await this.jobsReport.catalogLookups();
    const ids = new Set<string>();
    for (const d of deals) {
      if (tabs.has('tech')) for (const t of d.techIds) ids.add(t);
      if (tabs.has('dispatcher') && d.createdBy) ids.add(d.createdBy);
    }
    const users = ids.size ? await this.jobsReport.namesOfUsers([...ids]) : new Map<string, string>();
    const sources = new Map<string, { name: string; description?: string }>();
    for (const [id, name] of catalogs.sources) {
      const description = catalogs.sourceDescriptions.get(id);
      sources.set(id, description ? { name, description } : { name });
    }
    return {
      users,
      sources,
      externalCompanies: catalogs.externalCompanies,
      serviceAreas: catalogs.serviceAreas,
      jobTypes: catalogs.jobTypes,
    };
  }
}
