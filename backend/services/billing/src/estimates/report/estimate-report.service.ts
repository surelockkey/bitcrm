import { Injectable, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import type { Estimate, EstimateReportSummary, EstimateStatus, ListCount, ReportCsvExport } from '@bitcrm/types';
import { isAssignedOnly, type Caller } from '../../common/access';
import { CrmClient } from '../../integrations/crm.client';
import { DealClient } from '../../integrations/deal.client';
import { reportClients } from '../../integrations/report-clients';
import { UserClient } from '../../integrations/user.client';
import { dayWindow, reportToday } from '../../invoices/report/invoice-report.rules';
import { EstimateReportRepository } from './estimate-report.repository';
import { ESTIMATE_CSV_HEADERS, estimateCards, estimateCsvLine, type EstimateReportFilter } from './estimate-report.rules';

export const ESTIMATE_REPORT_EXPORT_MAX_ROWS = 25_000;
/** The cards of one window stay good this long (All time reads every estimate). */
const SUMMARY_TTL_SECONDS = 30;
/** Rows an importer wrote with no author to name. */
const NO_AUTHOR = 'workiz-import';

export interface EstimateReportQuery {
  from?: string;
  to?: string;
  status?: EstimateStatus;
  search?: string;
  limit?: number;
  cursor?: string;
}

/**
 * Workiz's Estimates page (`/root/estimates`): the six status cards for the
 * created-date window (all six — verified live 2026-09-29, the offline guess
 * of "open statuses only" was wrong), the list with its status select and
 * search, and Workiz's CSV.
 */
@Injectable()
export class EstimateReportService {
  constructor(
    private readonly repo: EstimateReportRepository,
    private readonly deal: DealClient,
    private readonly crm: CrmClient,
    private readonly users: UserClient,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async summary(q: Pick<EstimateReportQuery, 'from' | 'to'>, caller: Caller): Promise<EstimateReportSummary> {
    const window = dayWindow(q.from, q.to);
    const scoped = isAssignedOnly(caller, 'estimates');
    const compute = async () => {
      let rows = await this.repo.cardRows(window);
      if (scoped) {
        const mine = await this.deal.listDealIdsByTech(caller.user.id);
        rows = rows.filter((r) => mine.has(r.dealId));
      }
      return estimateCards(rows);
    };
    // A technician's cards are theirs alone — never cached under a shared key.
    const cards = scoped || !this.redis ? await compute() : await this.cached(`${q.from ?? ''}|${q.to ?? ''}`, compute);
    return { ...cards, ...(q.from && { from: q.from }), ...(q.to && { to: q.to }) } as EstimateReportSummary;
  }

  async list(q: EstimateReportQuery, caller: Caller): Promise<{ items: Estimate[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(Number(q.limit) || 10, 1), 100);
    const result = await this.repo.page(this.filterOf(q), limit, q.cursor);
    if (!isAssignedOnly(caller, 'estimates')) return result;
    const mine = await this.deal.listDealIdsByTech(caller.user.id);
    return { ...result, items: result.items.filter((e) => mine.has(e.dealId)) };
  }

  async count(q: EstimateReportQuery, caller: Caller): Promise<ListCount> {
    if (isAssignedOnly(caller, 'estimates')) return { total: null, atLeast: false };
    return this.repo.count(this.filterOf(q));
  }

  async exportCsv(q: EstimateReportQuery, caller: Caller, authorization?: string): Promise<ReportCsvExport> {
    let { items, truncated } = await this.repo.walk(this.filterOf(q), ESTIMATE_REPORT_EXPORT_MAX_ROWS);
    if (isAssignedOnly(caller, 'estimates')) {
      const mine = await this.deal.listDealIdsByTech(caller.user.id);
      items = items.filter((e) => mine.has(e.dealId));
    }
    const [clients, authors] = await Promise.all([
      reportClients(this.crm, items.map((e) => e.contactId), authorization),
      this.authorNames(items),
    ]);
    const span = q.from || q.to ? `${q.from ?? 'start'}_${q.to ?? reportToday()}` : 'all-time';
    return {
      filename: `estimates-${span}.csv`,
      csv: [
        ESTIMATE_CSV_HEADERS.join(','),
        ...items.map((e) => estimateCsvLine(e, clients.get(e.contactId), e.createdByName ?? authors.get(e.createdBy))),
      ].join('\n'),
      count: items.length,
      truncated,
    };
  }

  private filterOf(q: EstimateReportQuery): EstimateReportFilter {
    return {
      ...dayWindow(q.from, q.to),
      ...(q.status && { status: q.status }),
      ...(q.search?.trim() && { search: q.search.trim() }),
    };
  }

  /** "Created By" for estimates made here (imported ones carry Workiz's name). */
  private async authorNames(items: Estimate[]): Promise<Map<string, string>> {
    const ids = [...new Set(items.filter((e) => !e.createdByName && e.createdBy && e.createdBy !== NO_AUTHOR).map((e) => e.createdBy))];
    const out = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      try {
        for (const u of await this.users.namesByIds(ids.slice(i, i + 200))) {
          const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
          if (name) out.set(u.id, name);
        }
      } catch {
        // No names is an empty column, not a failed export.
      }
    }
    return out;
  }

  private async cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const k = `billing:estimates:report:summary:${key}`;
    try {
      const hit = await this.redis!.client.get(k);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      // Redis down: answer from the table.
    }
    const value = await compute();
    try {
      await this.redis!.client.set(k, JSON.stringify(value), 'EX', SUMMARY_TTL_SECONDS);
    } catch {
      // Not cached; still right.
    }
    return value;
  }
}
