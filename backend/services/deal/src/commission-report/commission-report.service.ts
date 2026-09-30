import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  COMMISSION_REPORT_BY,
  COMMISSION_REPORT_MODES,
  DataScope,
  type CommissionReport,
  type CommissionReportBy,
  type CommissionReportMode,
  type CommissionReportRow,
  type JwtUser,
} from '@bitcrm/types';
import { JobTypesRepository } from '../job-types/job-types.repository';
import { JobSourcesRepository } from '../job-sources/job-sources.repository';
import { ExternalCompaniesRepository } from '../external-companies/external-companies.repository';
import { CustomFieldsRepository } from '../custom-fields/custom-fields.repository';
import { CommissionReportRepository, shiftDay, type ItemsRead } from './commission-report.repository';
import { CommissionReportClient } from './commission-report.client';
import {
  buildRow,
  commissionReportCsv,
  externalSummaries,
  inPeriod,
  matchesFilters,
  matchesSearch,
  needsCompute,
  primaryTechOf,
  sortRows,
  techSummaries,
  totalsOf,
  type RowFilters,
} from './commission-report.rows';
import {
  COMMISSION_REPORT_SORT_KEYS,
  type CommissionDealItem,
  type CommissionReportQuery,
  type CommissionReportSortKey,
} from './commission-report.types';
import type { CommissionReportQueryDto } from './dto/commission-report-query.dto';

/**
 * "Closed" is the end of the visit window, but the index is keyed by its
 * start: a period is read from this many days before its first day. A job
 * whose window started earlier still is missed — 3 of 27 164 Done jobs since
 * 2025 had a window longer than 31 days.
 */
export const CLOSED_LOOKBACK_DAYS = 31;
/** The longest period one request reads (about six months). */
export const MAX_PERIOD_DAYS = 186;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
/** Paging, sorting and switching technicians re-use one read of the period for a minute. */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 8;

interface PeriodRows {
  at: number;
  rows: CommissionReportRow[];
  truncated: boolean;
  warnings: string[];
  /** Contacts already named, so a page is looked up once. */
  clientNames: Map<string, string>;
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * Workiz's "Commissions (Legacy)" report — "Finance Reporting".
 *
 * A period's Done jobs, one row each, with what was collected and how,
 * the technician's rate, their profit, the company's and the balance. An
 * imported job shows Workiz's own frozen numbers (`commissionSnapshot`); a
 * job done here goes through the Workiz formula with its ledger (billing),
 * the technician's rate in force on its day (user-service) and its parts.
 *
 * The data scope is `commission`'s: `assigned_only` (a technician) sees only
 * the jobs they are primary on, read off the tech index.
 */
@Injectable()
export class CommissionReportService {
  private readonly logger = new Logger(CommissionReportService.name);
  private readonly cache = new Map<string, PeriodRows>();

  constructor(
    private readonly repository: CommissionReportRepository,
    private readonly client: CommissionReportClient,
    private readonly jobTypes: JobTypesRepository,
    private readonly jobSources: JobSourcesRepository,
    private readonly externalCompanies: ExternalCompaniesRepository,
    private readonly customFields: CustomFieldsRepository,
  ) {}

  async report(dto: CommissionReportQueryDto, caller: JwtUser, dataScope?: string): Promise<CommissionReport> {
    const query = this.parse(dto, caller, dataScope);
    const period = await this.period(query, caller, dataScope, dto.fresh === '1' || dto.fresh === 'true');
    const filters = this.filtersOf(query);

    // A search can match a client, and an order by client needs them all: name the period first.
    const byClient = Boolean(query.q) || query.sort === 'clientName';
    if (byClient) await this.nameClients(period, period.rows);
    const rows = byClient ? period.rows.map((r) => this.withClient(r, period)) : period.rows;
    const shown = rows.filter((r) => matchesFilters(r, filters) && matchesSearch(r, query.q));
    const sorted = sortRows(shown, query.sort ?? 'closedDate', query.dir ?? 'asc');
    const page = sorted.slice(query.offset, query.offset + query.limit);
    await this.nameClients(period, page);

    return {
      window: { by: query.by, from: query.from, to: query.to },
      mode: query.mode,
      count: shown.length,
      offset: query.offset,
      limit: query.limit,
      rows: page.map((r) => this.withClient(r, period)),
      totals: totalsOf(shown),
      techs: techSummaries(period.rows.filter((r) => matchesFilters(r, filters, 'tech'))),
      externalCompanies: externalSummaries(period.rows.filter((r) => matchesFilters(r, filters, 'external'))),
      computedRows: shown.filter((r) => r.source === 'computed').length,
      truncated: period.truncated,
      warnings: period.warnings,
    };
  }

  /** The whole filtered, sorted set as CSV — the Export button. */
  async exportCsv(
    dto: CommissionReportQueryDto,
    caller: JwtUser,
    dataScope?: string,
  ): Promise<{ filename: string; csv: string }> {
    const query = this.parse(dto, caller, dataScope);
    const period = await this.period(query, caller, dataScope, dto.fresh === '1' || dto.fresh === 'true');
    await this.nameClients(period, period.rows);
    const filters = this.filtersOf(query);
    const shown = period.rows
      .map((r) => this.withClient(r, period))
      .filter((r) => matchesFilters(r, filters) && matchesSearch(r, query.q));
    const sorted = sortRows(shown, query.sort ?? 'closedDate', query.dir ?? 'asc');
    const tech = query.mode === 'tech' && query.techId ? `_${sorted[0]?.techName ?? query.techId}` : '';
    const filename = `commissions_${query.mode}${tech}_${query.by}_${query.from}_${query.to}.csv`.replace(/[^\w.-]+/g, '_');
    return { filename, csv: commissionReportCsv(sorted, totalsOf(sorted), query.mode) };
  }

  /* ------------------------------------------------------------ the query */

  /** Validated, defaulted, and narrowed to the caller's own jobs under `assigned_only`. */
  parse(dto: CommissionReportQueryDto, caller: JwtUser, dataScope?: string): CommissionReportQuery {
    const from = dto.from;
    if (!from) throw new BadRequestException('`from` (YYYY-MM-DD) is required');
    const to = dto.to || from;
    if (Number.isNaN(Date.parse(`${from}T00:00:00Z`)) || Number.isNaN(Date.parse(`${to}T00:00:00Z`))) {
      throw new BadRequestException('`from` / `to` must be real days (YYYY-MM-DD)');
    }
    if (to < from) throw new BadRequestException('`to` is before `from`');
    if (daysBetween(from, to) > MAX_PERIOD_DAYS) {
      throw new BadRequestException(`A period is at most ${MAX_PERIOD_DAYS} days`);
    }
    const by = (COMMISSION_REPORT_BY as readonly string[]).includes(dto.by ?? '') ? (dto.by as CommissionReportBy) : 'closed';
    const mode = (COMMISSION_REPORT_MODES as readonly string[]).includes(dto.mode ?? '')
      ? (dto.mode as CommissionReportMode)
      : 'standard';
    const ownOnly = dataScope === DataScope.ASSIGNED_ONLY;
    const techId = ownOnly ? caller.id : dto.techId || undefined;
    if (mode === 'tech' && !techId) throw new BadRequestException('The Tech report needs a technician (`techId`)');
    const sort = (COMMISSION_REPORT_SORT_KEYS as readonly string[]).includes(dto.sort ?? '')
      ? (dto.sort as CommissionReportSortKey)
      : undefined;
    const offset = Math.max(0, Math.floor(Number(dto.offset) || 0));
    const limit = Math.min(Math.max(Math.floor(Number(dto.limit) || DEFAULT_LIMIT), 1), MAX_LIMIT);
    return {
      from,
      to,
      by,
      mode,
      techId,
      jobTypeId: dto.jobTypeId || undefined,
      serviceAreaId: dto.serviceAreaId || undefined,
      externalCompanyId: dto.externalCompanyId || undefined,
      sourceId: dto.sourceId || undefined,
      q: dto.q?.trim() || undefined,
      sort,
      dir: dto.dir === 'desc' ? 'desc' : 'asc',
      offset,
      limit,
    };
  }

  private filtersOf(q: CommissionReportQuery): RowFilters {
    return {
      mode: q.mode,
      techId: q.techId,
      jobTypeId: q.jobTypeId,
      serviceAreaId: q.serviceAreaId,
      externalCompanyId: q.externalCompanyId,
      sourceId: q.sourceId,
    };
  }

  /* ----------------------------------------------------------- the period */

  /**
   * Every row of the period, built once a minute. The office's weekly round —
   * one technician after another over the same week — is one read.
   */
  private async period(
    q: CommissionReportQuery,
    caller: JwtUser,
    dataScope: string | undefined,
    fresh: boolean,
  ): Promise<PeriodRows> {
    const ownTech = dataScope === DataScope.ASSIGNED_ONLY ? caller.id : undefined;
    const key = `${q.by}|${q.from}|${q.to}|${ownTech ?? '*'}`;
    const hit = this.cache.get(key);
    if (hit && !fresh && Date.now() - hit.at < CACHE_TTL_MS) return hit;

    const read = await this.read(q, ownTech);
    const items = read.items.filter((i) => inPeriod(i, q.by, q.from, q.to) && (!ownTech || primaryTechOf(i) === ownTech));
    const { rows, warnings } = await this.build(items);
    const entry: PeriodRows = { at: Date.now(), rows, truncated: read.truncated, warnings, clientNames: new Map() };
    if (read.truncated) warnings.push('The period holds more jobs than one read allows — the figures are a floor.');

    this.cache.delete(key);
    this.cache.set(key, entry);
    while (this.cache.size > CACHE_MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
    return entry;
  }

  /** The index read for the period's "By Time" (a technician's own period off the tech index). */
  private read(q: CommissionReportQuery, ownTech?: string): Promise<ItemsRead> {
    if (q.by === 'created') {
      // Local days, any zone: a day either side covers every offset.
      return this.repository.findDoneByCreated(shiftDay(q.from, -1), `${shiftDay(q.to, 1)}T23:59:59.999Z`);
    }
    const from = q.by === 'closed' ? shiftDay(q.from, -CLOSED_LOOKBACK_DAYS) : q.from;
    return ownTech
      ? this.repository.findDoneByTech(ownTech, from, q.to)
      : this.repository.findDoneByVisitStart(from, q.to);
  }

  /** Rows for the items: names from the catalogs, the formula's inputs for the jobs done here. */
  private async build(items: CommissionDealItem[]): Promise<{ rows: CommissionReportRow[]; warnings: string[] }> {
    const warnings: string[] = [];
    const computed = items.filter(needsCompute);
    const techIds = [...new Set(items.map(primaryTechOf).filter((t): t is string => Boolean(t)))];
    const computedTechs = [...new Set(computed.map(primaryTechOf).filter((t): t is string => Boolean(t)))];

    const [techNames, jobTypes, sources, companies, fields, ledgers, configs] = await Promise.all([
      this.client.userNames(techIds),
      this.catalog(() => this.jobTypes.listAll()),
      this.catalog(() => this.jobSources.listAll()),
      this.catalog(() => this.externalCompanies.listAll()),
      this.customFields.listAll().catch(() => []),
      computed.length ? this.client.ledgers(computed.map((i) => i.id)) : Promise.resolve(new Map()),
      computedTechs.length ? this.client.commissionHistories(computedTechs) : Promise.resolve(new Map()),
    ]);
    if (!ledgers) warnings.push(`Payments could not be read for ${computed.length} job(s) done in BitCRM — their Cash, Credit and Check show 0.`);
    if (!configs) warnings.push(`Technician rates could not be read for ${computed.length} job(s) done in BitCRM — their Tech Profit shows the tip only.`);

    const fieldId = (name: string) => fields.find((f) => f.name?.trim().toLowerCase() === name)?.id;
    const ctx = {
      techNames,
      jobTypeNames: jobTypes,
      sourceNames: sources,
      externalCompanyNames: companies,
      partsFields: { tech: fieldId('tech parts cost'), company: fieldId('company parts cost') },
      payments: ledgers ?? new Map(),
      configs: configs ?? new Map(),
    };
    const rows = items.map((item) => {
      const row = buildRow(item, ctx);
      const override = [item.clientName?.firstName, item.clientName?.lastName].filter(Boolean).join(' ').trim();
      return override ? { ...row, clientName: override } : row;
    });
    return { rows, warnings };
  }

  private async catalog(list: () => Promise<Array<{ id: string; name: string }>>): Promise<Map<string, string>> {
    try {
      return new Map((await list()).map((c) => [c.id, c.name]));
    } catch (error) {
      this.logger.warn(`A catalog could not be read for the commissions report: ${(error as Error).message}`);
      return new Map();
    }
  }

  /** Names the clients of these rows that are not named yet (crm, names only). */
  private async nameClients(period: PeriodRows, rows: CommissionReportRow[]): Promise<void> {
    const missing = rows
      .filter((r) => !r.clientName && r.contactId && !period.clientNames.has(r.contactId))
      .map((r) => r.contactId as string);
    if (!missing.length) return;
    const names = await this.client.contactNames(missing);
    for (const id of new Set(missing)) period.clientNames.set(id, names.get(id) ?? '');
  }

  private withClient(row: CommissionReportRow, period: PeriodRows): CommissionReportRow {
    if (row.clientName || !row.contactId) return row;
    const name = period.clientNames.get(row.contactId);
    return name ? { ...row, clientName: name } : row;
  }
}
