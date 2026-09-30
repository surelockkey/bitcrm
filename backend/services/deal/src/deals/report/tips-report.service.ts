import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { hasPermission } from '@bitcrm/shared';
import type { ResolvedPermissions, TipsReportJobsPage, TipsReportPage } from '@bitcrm/types';
import { DealsRepository, ReportWindowTooLargeError } from '../deals.repository';
import { JobsReportService, type ReportCaller } from './jobs-report.service';
import { parseTipsReportJobsQuery, parseTipsReportQuery, type TipsReportJobsQueryDto, type TipsReportQueryDto } from './tips-report.query';
import {
  TIPS_PROJECTION,
  jobsOfTech,
  keptJobs,
  pageOfJobs,
  sortJobs,
  techAllowed,
  tipsByTech,
  toTechRow,
  toTipsDeal,
  type TipsDeal,
} from './tips-report.logic';

/**
 * A window read is the report's whole cost; opening a person's jobs, paging
 * and filtering then run over it in memory. Kept a minute per period, like
 * the Jobs report's — at most three periods, the oldest dropped first.
 */
const WINDOW_TTL_MS = 60_000;
const WINDOW_CACHE_MAX = 3;

/**
 * The Workiz Tips report (`GET /deals/report/tips`, `/deals/report/tips/jobs`).
 * Reads the jobs of a period off the schedule index (the Jobs report's
 * `readReportWindow`, "By: Job date" — every status), then splits each job's
 * tip between the people on it with the pure functions of
 * `tips-report.logic.ts`, the same ones the offline check against Workiz runs.
 * Names come through the Jobs report's caches.
 */
@Injectable()
export class TipsReportService {
  private readonly logger = new Logger(TipsReportService.name);
  private readonly windows = new Map<string, { at: number; deals: Promise<TipsDeal[]> }>();

  constructor(
    private readonly repository: DealsRepository,
    private readonly jobsReport: JobsReportService,
  ) {}

  /** Every person of the period, one line each. */
  async page(dto: TipsReportQueryDto, caller: ReportCaller): Promise<TipsReportPage> {
    const q = parseTipsReportQuery(dto);
    const money = hasMoney(caller.perms);
    const own = ownOnly(caller);
    const jobs = keptJobs(await this.windowDeals(q.from, q.to), q.from, q.to, q.filters);
    const totals = tipsByTech(jobs, q.filters, own);
    const { users } = await this.jobsReport.lookupsFor(jobs, false);
    return {
      rows: totals.map((t) => toTechRow(t, users.get(t.techId) ?? '', money)),
      window: { from: q.from, to: q.to },
      money,
    };
  }

  /** One person's jobs of the period — the row opened. */
  async jobs(dto: TipsReportJobsQueryDto, caller: ReportCaller): Promise<TipsReportJobsPage> {
    const q = parseTipsReportJobsQuery(dto);
    const money = hasMoney(caller.perms);
    const own = ownOnly(caller);
    if (own !== undefined && q.tech !== own) throw new ForbiddenException('You can see only your own tips');
    const empty: TipsReportJobsPage = {
      techId: q.tech,
      rows: [],
      pagination: { page: 1, pageSize: q.pageSize, total: 0, pages: 1, from: 0, to: 0 },
      sort: { column: q.sort, dir: q.dir },
      money,
    };
    // The Tech filter hides this person's row; its jobs are hidden with it.
    if (!techAllowed(q.tech, q.filters, own)) return empty;

    const kept = keptJobs(await this.windowDeals(q.from, q.to), q.from, q.to, q.filters);
    const mine = kept.filter((d) => d.techIds.includes(q.tech));
    if (!mine.length) return empty;
    // Names of every client only when the order depends on them; else only the page's.
    const byClient = q.sort === 'client';
    const lookups = await this.jobsReport.lookupsFor(mine, byClient);
    const rows = sortJobs(jobsOfTech(mine, q.tech, lookups, money), mine, q.sort, q.dir);
    const page = pageOfJobs(rows, q.page, q.pageSize);
    if (!byClient) await this.jobsReport.fillClients(page.rows);
    return { techId: q.tech, rows: page.rows, pagination: page.pagination, sort: { column: q.sort, dir: q.dir }, money };
  }

  private windowDeals(from: string, to: string): Promise<TipsDeal[]> {
    const key = `${from}|${to}`;
    const now = Date.now();
    const hit = this.windows.get(key);
    if (hit && now - hit.at < WINDOW_TTL_MS) return hit.deals;

    const deals = this.repository
      .readReportWindow('scheduled', from, to, TIPS_PROJECTION)
      .then((items) => items.map(toTipsDeal))
      .catch((err: unknown) => {
        this.windows.delete(key);
        if (err instanceof ReportWindowTooLargeError) {
          throw new BadRequestException(`${err.message} — choose a shorter period`);
        }
        const e = err as { name?: string; message?: string };
        if (e.name === 'ValidationException' && /index/i.test(e.message ?? '')) {
          this.logger.error(`Tips report: ${e.message}`);
          throw new ServiceUnavailableException('The Tips report is not available yet on this environment — its index is still being built');
        }
        throw err;
      });
    this.windows.delete(key);
    this.windows.set(key, { at: now, deals });
    for (const [k, v] of this.windows) {
      if (this.windows.size <= WINDOW_CACHE_MAX && now - v.at < WINDOW_TTL_MS) break;
      this.windows.delete(k);
    }
    return deals;
  }
}

/** Tips are money: without `financials.view` only the job counts are shown. */
const hasMoney = (perms?: ResolvedPermissions): boolean => hasPermission(perms, 'financials', 'view');

/** `assigned_only` sees their own line and their own jobs — as the jobs list and the Jobs report do. */
const ownOnly = (caller: ReportCaller): string | undefined =>
  caller.perms?.dataScope?.deals === 'assigned_only' ? caller.user.id : undefined;
