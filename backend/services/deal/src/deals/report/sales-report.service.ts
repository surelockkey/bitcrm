import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { hasPermission } from '@bitcrm/shared';
import {
  SALES_REPORT_BY,
  SALES_REPORT_COLUMN_IDS,
  SALES_REPORT_MONEY_COLUMNS,
  SALES_REPORT_STATUSES,
  type ResolvedPermissions,
  type JwtUser,
  type SalesReportBy,
  type SalesReportColumnId,
  type SalesReportPage,
  type SalesReportSettings,
} from '@bitcrm/types';
import { DealsRepository, ReportWindowTooLargeError } from '../deals.repository';
import { paginate, type RowOptions } from './jobs-report.logic';
import { JobsReportService, type CsvSink, type ReportCaller } from './jobs-report.service';
import { SalesReportSettingsRepository } from './sales-report-settings.repository';
import { parseSalesReportQuery, type SalesReportQuery, type SalesReportQueryDto } from './sales-report.query';
import {
  SALES_PROJECTION,
  matchesSalesSearch,
  salesByDay,
  salesCsvHeader,
  salesCsvLine,
  salesCsvTotalsLine,
  salesOf,
  salesTotals,
  sortSalesRows,
  toSalesDeal,
  toSalesRow,
  type SalesDeal,
} from './sales-report.logic';

/**
 * A window read is the report's whole cost; filtering, searching, sorting
 * and paging then run over it in memory. Kept a minute per (date, days) so
 * a page turn or a ticked filter does not read DynamoDB again. At most three
 * windows, the oldest dropped first — as the Jobs report.
 */
const WINDOW_TTL_MS = 60_000;
const WINDOW_CACHE_MAX = 3;
/** Rows the export names, fills and writes per step. */
const CSV_CHUNK_ROWS = 500;

/**
 * The Workiz Sales report (`GET /deals/report/sales`, `/sales/export`,
 * `/sales/settings`).
 *
 * 1. The period's jobs off the index of the chosen date —
 *    `DealsRepository.readReportWindow`, the Jobs report's read, only the
 *    five status partitions a sale can be in (no Canceled: two thirds of a
 *    window). The EndIndex is not split by status; its Canceled rows are
 *    dropped here.
 * 2. Sales among them (`isSale`: not Canceled, total above zero), on the
 *    exact account-calendar day, through the multi-filter.
 * 3. Names — catalogs, technicians, clients — through the Jobs report
 *    (`JobsReportService.lookupsFor`, `fillClients`, `fillContactDetails`).
 * 4. The search, the Total row, the chart, the sort, the page, the CSV — the
 *    pure functions of `sales-report.logic.ts`, the same ones the offline
 *    check against Workiz runs.
 */
@Injectable()
export class SalesReportService {
  private readonly logger = new Logger(SalesReportService.name);
  private readonly windows = new Map<string, { at: number; deals: Promise<SalesDeal[]> }>();

  constructor(
    private readonly repository: DealsRepository,
    private readonly settingsRepository: SalesReportSettingsRepository,
    private readonly jobs: JobsReportService,
  ) {}

  /* --------------------------------------------------------------- settings */

  getSettings(): Promise<SalesReportSettings> {
    return this.settingsRepository.get();
  }

  async saveSettings(input: { columns?: unknown; by?: unknown }, caller: JwtUser): Promise<SalesReportSettings> {
    const current = await this.settingsRepository.get();
    let columns = current.columns;
    if (input.columns !== undefined) {
      if (!Array.isArray(input.columns) || input.columns.some((c) => typeof c !== 'string')) {
        throw new BadRequestException('columns must be a list of column ids');
      }
      const unknown = (input.columns as string[]).filter((c) => !SALES_REPORT_COLUMN_IDS.includes(c as SalesReportColumnId));
      if (unknown.length) throw new BadRequestException(`Unknown columns: ${unknown.join(', ')}`);
      columns = SALES_REPORT_COLUMN_IDS.filter((c) => (input.columns as string[]).includes(c));
      // Workiz: "The report needs at least one field to display".
      if (!columns.length) throw new BadRequestException('At least one column must be visible');
    }
    let by = current.by;
    if (input.by !== undefined) {
      if (!(SALES_REPORT_BY as readonly unknown[]).includes(input.by)) throw new BadRequestException(`by must be one of ${SALES_REPORT_BY.join(', ')}`);
      by = input.by as SalesReportBy;
    }
    await this.settingsRepository.put({ columns, by }, caller.id);
    return { columns, by };
  }

  /* ------------------------------------------------------------------- page */

  async page(dto: SalesReportQueryDto, caller: ReportCaller): Promise<SalesReportPage> {
    const q = parseSalesReportQuery(dto);
    const by = q.by ?? (await this.settingsRepository.get()).by;
    const opts = this.rowOptions(caller.perms);
    const sort = this.sortColumn(q.sort, opts);
    const { rows, totals, chart } = await this.selection(q, by, caller, opts, sort === 'client');
    const { rows: pageRows, pagination } = paginate(sortSalesRows(rows, sort, q.dir), q.page, q.pageSize);
    await this.jobs.fillClients(pageRows);
    await this.jobs.fillContactDetails(pageRows, caller.authorization, opts);
    return {
      rows: pageRows,
      totals,
      chart,
      pagination,
      window: { by, from: q.from, to: q.to },
      sort: { column: sort, dir: q.dir },
      money: opts.money,
    };
  }

  /* ----------------------------------------------------------------- export */

  /**
   * The same query as the page, every row, as CSV of the visible columns
   * (the `columns` asked for, else the account's) with the Total row first,
   * as the grid. Everything that can fail — the query, the window read —
   * happens before the first byte, so a failure is still an error response.
   */
  async exportCsv(
    dto: SalesReportQueryDto,
    caller: ReportCaller,
    sink: CsvSink,
  ): Promise<{ rows: number; columns: SalesReportColumnId[]; by: SalesReportBy }> {
    const q = parseSalesReportQuery(dto);
    const settings = await this.settingsRepository.get();
    const by = q.by ?? settings.by;
    const opts = this.rowOptions(caller.perms);
    const columns = (q.columns ?? settings.columns).filter((c) => opts.money || !SALES_REPORT_MONEY_COLUMNS.includes(c));
    if (!columns.length) throw new BadRequestException('No column to export');
    const sort = this.sortColumn(q.sort, opts);
    const { rows, totals } = await this.selection(q, by, caller, opts, sort === 'client');
    const sorted = sortSalesRows(rows, sort, q.dir);

    await sink.write(`${salesCsvHeader(columns)}\r\n${salesCsvTotalsLine(totals, columns)}\r\n`);
    for (let i = 0; i < sorted.length; i += CSV_CHUNK_ROWS) {
      const chunk = sorted.slice(i, i + CSV_CHUNK_ROWS);
      if (columns.includes('client')) {
        await this.jobs.fillClients(chunk);
        await this.jobs.fillContactDetails(chunk, caller.authorization, opts);
      }
      await sink.write(chunk.map((r) => `${salesCsvLine(r, columns)}\r\n`).join(''));
    }
    // Workiz logs "Exported sales report"; this is its line in ours.
    this.logger.log(
      `Exported sales report: user ${caller.user.id}, by ${by} ${q.from}..${q.to}, ${sorted.length} rows, ${columns.length} columns`,
    );
    return { rows: sorted.length, columns, by };
  }

  /* -------------------------------------------------------------- internals */

  private rowOptions(perms?: ResolvedPermissions): RowOptions {
    return {
      money: hasPermission(perms, 'financials', 'view'),
      numbers: hasPermission(perms, 'contacts', 'view_numbers'),
    };
  }

  /** A money column cannot be sorted on by someone who may not see money — its order would tell. */
  private sortColumn(column: SalesReportColumnId, opts: RowOptions): SalesReportColumnId {
    return !opts.money && SALES_REPORT_MONEY_COLUMNS.includes(column) ? 'jobNumber' : column;
  }

  /**
   * The period's sales this caller may see, through the filters, named and
   * searched; the Total row over what the search keeps, and the chart over
   * what the filters keep (Workiz's chart does not take the search).
   */
  private async selection(q: SalesReportQuery, by: SalesReportBy, caller: ReportCaller, opts: RowOptions, namesOfAllClients: boolean) {
    const deals = await this.windowDeals(by, q.from, q.to);
    // `assigned_only` sees the jobs they are on — as the jobs list and the Jobs report do.
    const own = caller.perms?.dataScope?.deals === 'assigned_only' ? caller.user.id : undefined;
    const kept = salesOf(own ? deals.filter((d) => d.techIds.includes(own)) : deals, by, q.from, q.to, q.filters);
    const chart = opts.money ? salesByDay(kept, by, q.from, q.to) : [];

    // The search and the client sort read the client's name, so then every client is named up front.
    const lookups = await this.jobs.lookupsFor(kept, namesOfAllClients || Boolean(q.q));
    let entries = kept.map((deal) => ({ deal, row: toSalesRow(deal, lookups, opts) }));
    if (q.q) entries = entries.filter((e) => matchesSalesSearch(e.row, q.q));
    const totals = salesTotals(
      entries.map((e) => e.deal),
      opts.money,
    );
    return { rows: entries.map((e) => e.row), totals, chart };
  }

  private windowDeals(by: SalesReportBy, from: string, to: string): Promise<SalesDeal[]> {
    const key = `${by}|${from}|${to}`;
    const now = Date.now();
    const hit = this.windows.get(key);
    if (hit && now - hit.at < WINDOW_TTL_MS) return hit.deals;

    const deals = this.repository
      .readReportWindow(by, from, to, SALES_PROJECTION, { statuses: SALES_REPORT_STATUSES })
      .then((items) => items.map(toSalesDeal))
      .catch((err: unknown) => {
        this.windows.delete(key);
        if (err instanceof ReportWindowTooLargeError) {
          throw new BadRequestException(`${err.message} — choose a shorter period`);
        }
        // An environment deployed before its EndIndex was built (terraform apply) answers this.
        const e = err as { name?: string; message?: string };
        if (e.name === 'ValidationException' && /index/i.test(e.message ?? '')) {
          this.logger.error(`Sales report: ${e.message}`);
          throw new ServiceUnavailableException(
            `"By: ${by === 'end' ? 'Job end date' : by}" is not available yet on this environment — its index is still being built`,
          );
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
