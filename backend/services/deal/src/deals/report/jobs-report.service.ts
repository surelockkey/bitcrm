import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { hasPermission } from '@bitcrm/shared';
import {
  JOBS_REPORT_BY,
  JOBS_REPORT_COLUMN_IDS,
  type JobsReportBy,
  type JobsReportColumnId,
  type JobsReportPage,
  type JobsReportRow,
  type JobsReportSettings,
  type JwtUser,
  type PersonName,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { DealsRepository, ReportWindowTooLargeError } from '../deals.repository';
import { InternalHttpService } from '../../common/services/internal-http.service';
import { JobTypesService } from '../../job-types/job-types.service';
import { JobSourcesService } from '../../job-sources/job-sources.service';
import { JobTagsService } from '../../job-tags/job-tags.service';
import { JobStatusesService } from '../../job-statuses/job-statuses.service';
import { ServiceAreasService } from '../../service-areas/service-areas.service';
import { ExternalCompaniesService } from '../../external-companies/external-companies.service';
import { JobsReportSettingsRepository } from './jobs-report-settings.repository';
import { parseJobsReportQuery, type JobsReportQuery, type JobsReportQueryDto } from './jobs-report.query';
import {
  REPORT_PROJECTION,
  csvHeader,
  csvLine,
  emptyLookups,
  inWindow,
  isReportable,
  matchesFilters,
  matchesSearch,
  paginate,
  sortRows,
  toReportDeal,
  toRow,
  type ReportDeal,
  type ReportLookups,
  type RowOptions,
} from './jobs-report.logic';

/** Who is asking, with what grants — and their token, for crm's per-caller masking. */
export interface ReportCaller {
  user: JwtUser;
  perms?: ResolvedPermissions;
  authorization?: string;
}

/** Where the CSV goes, a chunk at a time. */
export interface CsvSink {
  write(chunk: string): void | Promise<void>;
}

/**
 * A window read is the report's whole cost; paging, sorting and filtering
 * then run over it in memory. Kept a minute per (date, days) so turning a
 * page or ticking a filter does not read DynamoDB again — the Workiz report
 * is minutes-fresh too. At most three windows, the oldest dropped first.
 */
const WINDOW_TTL_MS = 60_000;
const WINDOW_CACHE_MAX = 3;
/** Catalog names (types, sources, tags…) — small, and read on every page. */
const CATALOG_TTL_MS = 60_000;
/** Person names change rarely; a report re-asks after five minutes. */
const NAMES_TTL_MS = 5 * 60_000;
const NAMES_CACHE_MAX = 200_000;
/** crm answers 100 contacts a body; this many bodies go out at once. */
const CONTACT_BATCH = 100;
const CONTACT_PARALLEL = 6;
/** Rows the export names, fills and writes per step. */
const CSV_CHUNK_ROWS = 500;

interface Entry {
  deal: ReportDeal;
  row: JobsReportRow;
}

const fullName = (p: PersonName): string => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();

/**
 * The Workiz Jobs report (`GET /deals/report`, `/deals/report/export`,
 * `/deals/report/settings`). Reads one window of deals off the index of the
 * chosen date (`DealsRepository.readReportWindow`), then does everything
 * else — Workiz's multi-filter, search, sort on any column, paging, names,
 * CSV — with the pure functions of `jobs-report.logic.ts`, the same ones the
 * offline check against Workiz's own numbers runs.
 */
@Injectable()
export class JobsReportService {
  private readonly logger = new Logger(JobsReportService.name);
  private readonly windows = new Map<string, { at: number; deals: Promise<ReportDeal[]> }>();
  private catalogs?: { at: number; lookups: Promise<ReportLookups> };
  private readonly userNames = new Map<string, { at: number; name: string }>();
  private readonly clientNames = new Map<string, { at: number; name: string }>();

  constructor(
    private readonly repository: DealsRepository,
    private readonly settingsRepository: JobsReportSettingsRepository,
    private readonly internalHttp: InternalHttpService,
    private readonly jobTypes: JobTypesService,
    private readonly jobSources: JobSourcesService,
    private readonly jobTags: JobTagsService,
    private readonly jobStatuses: JobStatusesService,
    private readonly serviceAreas: ServiceAreasService,
    private readonly externalCompanies: ExternalCompaniesService,
  ) {}

  /* --------------------------------------------------------------- settings */

  getSettings(): Promise<JobsReportSettings> {
    return this.settingsRepository.get();
  }

  async saveSettings(input: { columns?: unknown; by?: unknown }, caller: JwtUser): Promise<JobsReportSettings> {
    const current = await this.settingsRepository.get();
    let columns = current.columns;
    if (input.columns !== undefined) {
      if (!Array.isArray(input.columns) || input.columns.some((c) => typeof c !== 'string')) {
        throw new BadRequestException('columns must be a list of column ids');
      }
      const unknown = (input.columns as string[]).filter((c) => !JOBS_REPORT_COLUMN_IDS.includes(c as JobsReportColumnId));
      if (unknown.length) throw new BadRequestException(`Unknown columns: ${unknown.join(', ')}`);
      columns = JOBS_REPORT_COLUMN_IDS.filter((c) => (input.columns as string[]).includes(c));
      // Workiz: "at least one field must be selected".
      if (!columns.length) throw new BadRequestException('At least one column must be visible');
    }
    let by = current.by;
    if (input.by !== undefined) {
      if (!(JOBS_REPORT_BY as readonly unknown[]).includes(input.by)) throw new BadRequestException(`by must be one of ${JOBS_REPORT_BY.join(', ')}`);
      by = input.by as JobsReportBy;
    }
    await this.settingsRepository.put({ columns, by }, caller.id);
    return { columns, by };
  }

  /* ------------------------------------------------------------------- page */

  async page(dto: JobsReportQueryDto, caller: ReportCaller): Promise<JobsReportPage> {
    const q = parseJobsReportQuery(dto);
    const by = q.by ?? (await this.settingsRepository.get()).by;
    const opts = this.rowOptions(caller.perms);
    const sort = this.sortColumn(q.sort, opts);
    const entries = await this.entries(q, by, caller, opts, sort === 'client' || Boolean(q.q));
    const sorted = sortRows(
      entries.map((e) => e.row),
      sort,
      q.dir,
    );
    const { rows, pagination } = paginate(sorted, q.page, q.pageSize);
    await this.fillClients(rows);
    await this.fillContactDetails(rows, caller.authorization, opts);
    return { rows, pagination, window: { by, from: q.from, to: q.to }, sort: { column: sort, dir: q.dir }, money: opts.money };
  }

  /* ----------------------------------------------------------------- export */

  /**
   * The same query as the page, every row of it, as CSV of the visible
   * columns (the `columns` asked for, else the account's), in the report's
   * order. Everything that can fail — the query, the window read — happens
   * before the first byte, so a failure is still a proper error response.
   */
  async exportCsv(
    dto: JobsReportQueryDto,
    caller: ReportCaller,
    sink: CsvSink,
  ): Promise<{ rows: number; columns: JobsReportColumnId[]; by: JobsReportBy }> {
    const q = parseJobsReportQuery(dto);
    const settings = await this.settingsRepository.get();
    const by = q.by ?? settings.by;
    const opts = this.rowOptions(caller.perms);
    const columns = (q.columns ?? settings.columns).filter((c) => opts.money || c !== 'total');
    if (!columns.length) throw new BadRequestException('No column to export');
    const sort = this.sortColumn(q.sort, opts);
    const entries = await this.entries(q, by, caller, opts, sort === 'client' || Boolean(q.q));
    const rows = sortRows(
      entries.map((e) => e.row),
      sort,
      q.dir,
    );

    await sink.write(`${csvHeader(columns)}\r\n`);
    for (let i = 0; i < rows.length; i += CSV_CHUNK_ROWS) {
      const chunk = rows.slice(i, i + CSV_CHUNK_ROWS);
      if (columns.includes('client')) await this.fillClients(chunk);
      if (columns.includes('phone') || columns.includes('email')) await this.fillContactDetails(chunk, caller.authorization, opts);
      await sink.write(chunk.map((r) => `${csvLine(r, columns)}\r\n`).join(''));
    }
    // Workiz logs "Exported jobs report"; this is its line in ours.
    this.logger.log(
      `Exported jobs report: user ${caller.user.id}, by ${by} ${q.from}..${q.to}, ${rows.length} rows, ${columns.length} columns`,
    );
    return { rows: rows.length, columns, by };
  }

  /* -------------------------------------------------------------- internals */

  private rowOptions(perms?: ResolvedPermissions): RowOptions {
    return {
      money: hasPermission(perms, 'financials', 'view'),
      numbers: hasPermission(perms, 'contacts', 'view_numbers'),
    };
  }

  /** A column whose values are withheld cannot be sorted on either — its order would tell them. */
  private sortColumn(column: JobsReportColumnId, opts: RowOptions): JobsReportColumnId {
    if (column === 'total' && !opts.money) return 'created';
    if (column === 'phone' && !opts.numbers) return 'created';
    return column;
  }

  /** The window's jobs, filtered, scoped, named and searched — unsorted. */
  private async entries(
    q: JobsReportQuery,
    by: JobsReportBy,
    caller: ReportCaller,
    opts: RowOptions,
    namesOfAllClients: boolean,
  ): Promise<Entry[]> {
    const deals = await this.windowDeals(by, q.from, q.to);
    // `assigned_only` sees the jobs they are on — as the jobs list and the stats do.
    const own = caller.perms?.dataScope?.deals === 'assigned_only' ? caller.user.id : undefined;
    const kept = deals.filter(
      (d) =>
        isReportable(d) &&
        inWindow(d, by, q.from, q.to) &&
        (!own || d.techIds.includes(own)) &&
        matchesFilters(d, q.filters),
    );
    const lookups = await this.lookupsFor(kept, namesOfAllClients);
    let entries = kept.map((deal) => ({ deal, row: toRow(deal, lookups, opts) }));
    if (q.q) entries = entries.filter((e) => matchesSearch(e.row, q.q, e.deal.jobSerial));
    return entries;
  }

  private async windowDeals(by: JobsReportBy, from: string, to: string): Promise<ReportDeal[]> {
    const key = `${by}|${from}|${to}`;
    const now = Date.now();
    const hit = this.windows.get(key);
    if (hit && now - hit.at < WINDOW_TTL_MS) return hit.deals;

    const deals = this.repository
      .readReportWindow(by, from, to, REPORT_PROJECTION)
      .then((items) => items.map(toReportDeal))
      .catch((err: unknown) => {
        this.windows.delete(key);
        if (err instanceof ReportWindowTooLargeError) {
          throw new BadRequestException(`${err.message} — choose a shorter period`);
        }
        // An environment deployed before its EndIndex was built (terraform apply) answers this.
        const e = err as { name?: string; message?: string };
        if (e.name === 'ValidationException' && /index/i.test(e.message ?? '')) {
          this.logger.error(`Jobs report: ${e.message}`);
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

  /**
   * Every name the kept jobs refer to: catalogs, people and — when asked —
   * clients. Also the Sales report's, whose rows are this report's plus money.
   */
  async lookupsFor(deals: ReportDeal[], clients: boolean): Promise<ReportLookups> {
    const catalogs = await this.catalogLookups();
    const users = await this.namesOfUsers([...new Set(deals.flatMap((d) => [...d.techIds, d.createdBy ?? '']))]);
    const lookups: ReportLookups = { ...catalogs, users, clients: new Map() };
    if (clients) {
      lookups.clients = await this.namesOfClients([...new Set(deals.filter((d) => !d.clientName).map((d) => d.contactId))]);
    }
    return lookups;
  }

  private catalogLookups(): Promise<ReportLookups> {
    const now = Date.now();
    if (this.catalogs && now - this.catalogs.at < CATALOG_TTL_MS) return this.catalogs.lookups;
    const lookups = (async () => {
      const lk = emptyLookups();
      const settle = async <T>(what: string, load: () => Promise<T[]>): Promise<T[]> => {
        try {
          return await load();
        } catch (err) {
          // A catalog that cannot be read costs its names, never the report.
          this.logger.warn(`Jobs report: ${what} unavailable: ${(err as Error).message}`);
          return [];
        }
      };
      const [types, sources, tags, statuses, areas, companies] = await Promise.all([
        settle('job types', () => this.jobTypes.list()),
        settle('job sources', () => this.jobSources.list()),
        settle('job tags', () => this.jobTags.list()),
        settle('job statuses', () => this.jobStatuses.list()),
        settle('service areas', () => this.serviceAreas.list()),
        settle('external companies', () => this.externalCompanies.list()),
      ]);
      for (const t of types) lk.jobTypes.set(t.id, t.name);
      for (const s of sources) lk.sources.set(s.id, s.name);
      for (const t of tags) lk.tags.set(t.id, { name: t.name, color: t.color });
      for (const s of statuses) lk.subStatuses.set(s.id, s.name);
      for (const a of areas) lk.serviceAreas.set(a.id, a.name);
      for (const c of companies) lk.externalCompanies.set(c.id, c.name);
      return lk;
    })();
    this.catalogs = { at: now, lookups };
    lookups.catch(() => (this.catalogs = undefined));
    return lookups;
  }

  private async namesOfUsers(ids: string[]): Promise<Map<string, string>> {
    return this.cachedNames(this.userNames, ids, (missing) => this.internalHttp.getUserNamesBatch(missing));
  }

  private async namesOfClients(ids: string[]): Promise<Map<string, string>> {
    return this.cachedNames(this.clientNames, ids, async (missing) => {
      const out: PersonName[] = [];
      const batches: string[][] = [];
      for (let i = 0; i < missing.length; i += CONTACT_BATCH) batches.push(missing.slice(i, i + CONTACT_BATCH));
      for (let i = 0; i < batches.length; i += CONTACT_PARALLEL) {
        const answers = await Promise.all(batches.slice(i, i + CONTACT_PARALLEL).map((b) => this.internalHttp.getContactNames(b)));
        for (const a of answers) out.push(...a);
      }
      return out;
    });
  }

  /** Names by id through a five-minute cache; an id the source does not know is remembered as blank. */
  private async cachedNames(
    cache: Map<string, { at: number; name: string }>,
    ids: string[],
    load: (missing: string[]) => Promise<PersonName[]>,
  ): Promise<Map<string, string>> {
    const now = Date.now();
    const out = new Map<string, string>();
    const missing: string[] = [];
    for (const id of ids) {
      if (!id) continue;
      const hit = cache.get(id);
      if (hit && now - hit.at < NAMES_TTL_MS) {
        if (hit.name) out.set(id, hit.name);
      } else missing.push(id);
    }
    if (missing.length) {
      const found = new Map((await load(missing)).map((p) => [p.id, fullName(p)]));
      if (cache.size + missing.length > NAMES_CACHE_MAX) cache.clear();
      for (const id of missing) {
        const name = found.get(id) ?? '';
        // A failed load answers nothing at all — do not remember that as "no name".
        if (found.size) cache.set(id, { at: now, name });
        if (name) out.set(id, name);
      }
    }
    return out;
  }

  /** Clients of rows that have no name yet (page rows, export chunks) — this report's and the Sales report's. */
  async fillClients(rows: Pick<JobsReportRow, 'contactId' | 'client'>[]): Promise<void> {
    const need = [...new Set(rows.filter((r) => !r.client && r.contactId).map((r) => r.contactId))];
    if (!need.length) return;
    const names = await this.namesOfClients(need);
    for (const r of rows) if (!r.client) r.client = names.get(r.contactId) ?? '';
  }

  /**
   * The number and email of rows whose job carries none of its own — a job
   * created here keeps them on the client. Asked of crm AS THE CALLER, so the
   * number is masked exactly as crm masks it for them.
   */
  async fillContactDetails(
    rows: Pick<JobsReportRow, 'contactId' | 'phone' | 'phoneMasked' | 'email'>[],
    authorization: string | undefined,
    opts: RowOptions,
  ): Promise<void> {
    const need = [...new Set(rows.filter((r) => r.contactId && ((!r.phone && !r.phoneMasked) || !r.email)).map((r) => r.contactId))];
    if (!need.length || !authorization) return;
    const contacts = new Map<string, { phones: string[]; emails: string[]; phonesMasked?: boolean }>();
    for (let i = 0; i < need.length; i += CONTACT_BATCH * CONTACT_PARALLEL) {
      const slice = need.slice(i, i + CONTACT_BATCH * CONTACT_PARALLEL);
      const batches: string[][] = [];
      for (let j = 0; j < slice.length; j += CONTACT_BATCH) batches.push(slice.slice(j, j + CONTACT_BATCH));
      const answers = await Promise.all(batches.map((b) => this.internalHttp.getContactsAsCaller(b, authorization)));
      for (const c of answers.flat()) contacts.set(c.id, { phones: c.phones ?? [], emails: c.emails ?? [], phonesMasked: c.phonesMasked });
    }
    for (const r of rows) {
      const c = contacts.get(r.contactId);
      if (!c) continue;
      if (!r.phone && !r.phoneMasked) {
        if (c.phones[0] && opts.numbers) r.phone = c.phones[0];
        else if (c.phonesMasked || (c.phones[0] && !opts.numbers)) r.phoneMasked = true;
      }
      if (!r.email && c.emails[0]) r.email = c.emails[0];
    }
  }
}
