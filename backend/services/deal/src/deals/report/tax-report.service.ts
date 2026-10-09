import { BadRequestException, ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { hasPermission } from '@bitcrm/shared';
import {
  JOBS_REPORT_MAX_DAYS,
  type JwtUser,
  type ReportCsvExport,
  type ResolvedPermissions,
  type TaxReport,
  type TaxReportBasis,
  type TaxReportBy,
} from '@bitcrm/types';
import { BillingReportsClient } from '../../common/services/billing-reports.client';
import { TaxRatesService } from '../../tax-rates/tax-rates.service';
import { ReportWindowTooLargeError } from '../deals.repository';
import { reportDay, type ReportDateSource } from './report-dates';
import { TaxReportRepository } from './tax-report.repository';
import {
  TAX_CSV_HEADERS,
  accrualRows,
  dealTaxFigures,
  filterTaxRows,
  paidRows,
  sortTaxRows,
  sumAmount,
  taxCsvLine,
  taxOptions,
  type DealTaxFigures,
  type TaxDealRow,
} from './tax-report.rules';

export interface TaxReportQuery {
  basis?: TaxReportBasis;
  by?: TaxReportBy;
  from: string;
  to: string;
  /** "Tax to show": a row key (`<name>|<percent>`). */
  tax?: string;
  search?: string;
}

export interface TaxReportCaller {
  user: JwtUser;
  perms?: ResolvedPermissions | null;
}

const DAY_MS = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/**
 * Workiz Reports → Tax: Accrual (tax on what was sold, windowed on the job's
 * created / job / end date — this account's default is Job end date) and
 * Paid (tax on what was collected, windowed on the payment date). One row per
 * tax rate the jobs carried; money only — `financials.view` is required.
 */
@Injectable()
export class TaxReportService {
  private readonly logger = new Logger(TaxReportService.name);

  constructor(
    private readonly repo: TaxReportRepository,
    private readonly billing: BillingReportsClient,
    private readonly taxRates: TaxRatesService,
  ) {}

  async report(q: TaxReportQuery, caller: TaxReportCaller): Promise<TaxReport> {
    this.assertMoney(caller);
    const basis = q.basis ?? 'accrual';
    const by = q.by ?? 'end';
    if (q.from > q.to) throw new BadRequestException('from must not be after to');
    if (days(q.from, q.to) > JOBS_REPORT_MAX_DAYS) {
      throw new BadRequestException(`A period can span at most ${JOBS_REPORT_MAX_DAYS} days`);
    }

    const [all, accountRates] = await Promise.all([
      basis === 'paid' ? this.paid(q.from, q.to, caller) : this.accrual(by, q.from, q.to, caller),
      this.accountRates(),
    ]);
    const rows = sortTaxRows(filterTaxRows(all, { tax: q.tax, search: q.search }), basis);
    return {
      basis,
      ...(basis === 'accrual' && { by }),
      from: q.from,
      to: q.to,
      rows,
      totalAmount: sumAmount(rows),
      taxes: taxOptions(all, accountRates),
    };
  }

  /** Every tax the account has (archived areas too) — the "Tax to show" list; the window's rates alone if unreadable. */
  private async accountRates(): Promise<Array<{ name: string; ratePercent: number }>> {
    try {
      return await this.taxRates.listAll();
    } catch (err) {
      this.logger.warn(`Tax report: the account's taxes are unavailable (${(err as Error).message}) — offering the period's rates`);
      return [];
    }
  }

  async exportCsv(q: TaxReportQuery, caller: TaxReportCaller): Promise<ReportCsvExport> {
    const r = await this.report(q, caller);
    return {
      filename: `tax-${r.basis}-${r.from}_${r.to}.csv`,
      csv: [TAX_CSV_HEADERS[r.basis].join(','), ...r.rows.map((row) => taxCsvLine(row, r.basis))].join('\n'),
      count: r.rows.length,
      truncated: false,
    };
  }

  // ---------------------------------------------------------------- tabs

  private async accrual(by: TaxReportBy, from: string, to: string, caller: TaxReportCaller) {
    let rows: Record<string, unknown>[];
    try {
      rows = await this.repo.window(by, from, to);
    } catch (err) {
      if (err instanceof ReportWindowTooLargeError) throw new BadRequestException(`${err.message} — choose a shorter period`);
      const e = err as { name?: string; message?: string };
      if (e.name === 'ValidationException' && /index/i.test(e.message ?? '')) {
        this.logger.error(`Tax report: ${e.message}`);
        throw new ServiceUnavailableException('"By: Job end date" is not available yet on this environment — its index is still being built');
      }
      throw err;
    }
    const jobs: DealTaxFigures[] = [];
    for (const row of this.scoped(rows as unknown as TaxDealRow[], caller)) {
      // The indexes hold the window plus its edges; the account-calendar day decides.
      const day = reportDay(row as ReportDateSource, by);
      if (!day || day < from || day > to) continue;
      const f = dealTaxFigures(row);
      if (f) jobs.push(f);
    }
    return accrualRows(jobs);
  }

  private async paid(from: string, to: string, caller: TaxReportCaller) {
    const collected = await this.billing.paidByJob(from, to);
    const byDeal = new Map(collected.filter((c) => c.paid > 0).map((c) => [c.dealId, c.paid]));
    const rows = this.scoped(await this.repo.byIds([...byDeal.keys()]), caller);
    const jobs: Array<{ figures: DealTaxFigures; collected: number }> = [];
    for (const row of rows) {
      const f = dealTaxFigures(row);
      if (f) jobs.push({ figures: f, collected: byDeal.get(row.id) ?? 0 });
    }
    return paidRows(jobs);
  }

  // -------------------------------------------------------------- access

  private assertMoney(caller: TaxReportCaller): void {
    if (!hasPermission(caller.perms ?? undefined, 'financials', 'view')) {
      throw new ForbiddenException('The Tax report needs financials.view');
    }
  }

  /** `assigned_only` on deals sees the jobs they are on — as the Jobs report does. */
  private scoped<T extends TaxDealRow>(rows: T[], caller: TaxReportCaller): T[] {
    if (caller.perms?.dataScope?.deals !== 'assigned_only') return rows;
    return rows.filter((r) => (r.assignedTechIds ?? []).includes(caller.user.id));
  }
}
