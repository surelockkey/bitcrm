import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { hasPermission } from '@bitcrm/shared';
import {
  JobSuperStatus,
  type ItemsReportJobRow,
  type ItemsReportJobsPage,
  type ItemsReportPage,
  type ItemsReportSort,
  type PersonName,
} from '@bitcrm/types';
import { DealsRepository, ReportWindowTooLargeError } from '../deals.repository';
import { InternalHttpService } from '../../common/services/internal-http.service';
import { paginate } from './jobs-report.logic';
import type { ReportCaller } from './jobs-report.service';
import { ItemsReportRepository } from './items-report.repository';
import { parseItemsReportQuery, type ItemsReportQuery, type ItemsReportQueryDto } from './items-report.query';
import {
  ITEMS_DEAL_PROJECTION,
  ITEMS_LINE_PROJECTION,
  aggregate,
  isCounted,
  itemsCsv,
  jobsOfItem,
  matchesItemFilters,
  matchesItemSearch,
  productFacts,
  sortItemRows,
  toItemLine,
  toItemsDeal,
  type ProductFacts,
  type WindowLine,
} from './items-report.logic';

/**
 * A window read — Done jobs, their lines, their price-book items — is the
 * report's whole cost; paging, sorting, filtering and the drill-down run
 * over it in memory. Kept a minute per period, at most three periods.
 */
const WINDOW_TTL_MS = 60_000;
const WINDOW_CACHE_MAX = 3;
/** Price-book items change rarely; a report re-asks after five minutes. */
const PRODUCT_TTL_MS = 5 * 60_000;
const PRODUCT_CACHE_MAX = 50_000;
const NAMES_TTL_MS = 5 * 60_000;
const NAMES_CACHE_MAX = 20_000;
/**
 * The most Done jobs one window may hold — each is a Query for its lines. A
 * year of this business is ~13 000.
 */
export const ITEMS_REPORT_MAX_JOBS = 30_000;

interface Window {
  entries: WindowLine[];
  products: Map<string, ProductFacts>;
}

const fullName = (p: PersonName): string => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();

/**
 * The Workiz Items and services report (`GET /deals/report/items`,
 * `/items/jobs`, `/items/export`).
 *
 * 1. The period's Done jobs off the StatusScheduleIndex (`STATUS#done`, the
 *    job date's days) — `DealsRepository.readReportWindow`, Done partitions only.
 * 2. Each job's `PRODUCT#` lines (`ItemsReportRepository`), service fee and
 *    discount lines dropped.
 * 3. The price book for the items' current name, type, model and category
 *    (inventory's internal route, `InternalHttpService.getProductsForReport`).
 * 4. Everything else — Workiz's multi-filter, the grouping, search, sort,
 *    paging, the drill-down, the CSV — with the pure functions of
 *    `items-report.logic.ts`, the same ones the offline check runs.
 */
@Injectable()
export class ItemsReportService {
  private readonly logger = new Logger(ItemsReportService.name);
  private readonly windows = new Map<string, { at: number; window: Promise<Window> }>();
  private readonly productCache = new Map<string, { at: number; facts: ProductFacts }>();
  private readonly userNames = new Map<string, { at: number; name: string }>();
  private readonly clientNames = new Map<string, { at: number; name: string }>();

  constructor(
    private readonly repository: DealsRepository,
    private readonly lines: ItemsReportRepository,
    private readonly internalHttp: InternalHttpService,
  ) {}

  /* ------------------------------------------------------------------- page */

  async page(dto: ItemsReportQueryDto, caller: ReportCaller): Promise<ItemsReportPage> {
    const q = parseItemsReportQuery(dto);
    const money = hasPermission(caller.perms, 'financials', 'view');
    const { rows, totals, window, scoped } = await this.rows(q, caller, money);
    const sort = this.sortColumn(q.sort, money);
    const { rows: pageRows, pagination } = paginate(sortItemRows(rows, sort, q.dir), q.page, q.pageSize);

    // What the filter can offer: every category and seller of the period, whatever is ticked.
    const categories = new Set<string>();
    const sellers = new Set<string>();
    for (const { line } of scoped) {
      const c = line.productId ? window.products.get(line.productId)?.category : undefined;
      if (c) categories.add(c);
      if (line.soldBy) sellers.add(line.soldBy);
    }
    const names = await this.namesOfUsers([...sellers]);
    return {
      rows: pageRows,
      totals,
      pagination,
      window: { from: q.from, to: q.to },
      sort: { column: sort, dir: q.dir },
      money,
      options: {
        categories: [...categories].sort((a, b) => a.localeCompare(b)),
        soldBy: [...sellers]
          .map((id) => ({ id, name: names.get(id) ?? '' }))
          .filter((p) => p.name)
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    };
  }

  /* ------------------------------------------------------------- drill-down */

  /** The jobs of one item (`item` = the row's key) over the same period and filters — Workiz's expanded row. */
  async jobs(dto: ItemsReportQueryDto, caller: ReportCaller): Promise<ItemsReportJobsPage> {
    const q = parseItemsReportQuery(dto);
    if (!q.item) throw new BadRequestException('item is required');
    const money = hasPermission(caller.perms, 'financials', 'view');
    const { window, filtered } = await this.filtered(q, caller);
    const mine = filtered.filter((e) => e.line.key === q.item);
    const item = aggregate(mine, window.products, money).rows[0] ?? null;
    const drafts = jobsOfItem(mine, q.item, money);
    const { rows: page, pagination } = paginate(drafts, q.page, q.pageSize);

    const clients = await this.namesOfClients([...new Set(page.filter((r) => !r.client).map((r) => r.contactId))]);
    const users = await this.namesOfUsers([...new Set(page.flatMap((r) => r.soldByIds))]);
    const rows: ItemsReportJobRow[] = page.map(({ soldByIds, ...r }) => ({
      ...r,
      client: r.client ?? clients.get(r.contactId) ?? '',
      soldBy: soldByIds.map((id) => ({ id, name: users.get(id) ?? '' })),
    }));
    return { item, rows, pagination, money };
  }

  /* ----------------------------------------------------------------- export */

  /**
   * The same query as the page, every row, as Workiz's CSV — `Totals`
   * first. A few hundred rows: built whole before the first byte, so a
   * failure is still a proper error response.
   */
  async exportCsv(dto: ItemsReportQueryDto, caller: ReportCaller): Promise<{ csv: string; rows: number; from: string; to: string }> {
    const q = parseItemsReportQuery(dto);
    const money = hasPermission(caller.perms, 'financials', 'view');
    const { rows, totals } = await this.rows(q, caller, money);
    const sorted = sortItemRows(rows, this.sortColumn(q.sort, money), q.dir);
    // Workiz logs `POST /crm/activity/export {page: itemsReport}`; this is its line in ours.
    this.logger.log(`Exported items report: user ${caller.user.id}, ${q.from}..${q.to}, ${sorted.length} rows`);
    return { csv: itemsCsv(sorted, totals, money), rows: sorted.length, from: q.from, to: q.to };
  }

  /* -------------------------------------------------------------- internals */

  /** A money column cannot be sorted on by someone who may not see money — its order would tell. */
  private sortColumn(column: ItemsReportSort, money: boolean): ItemsReportSort {
    return !money && (column === 'price' || column === 'cost' || column === 'profit') ? 'number' : column;
  }

  /** The window's lines this caller may see, and those of them the filters keep. */
  private async filtered(q: ItemsReportQuery, caller: ReportCaller): Promise<{ window: Window; scoped: WindowLine[]; filtered: WindowLine[] }> {
    const window = await this.window(q.from, q.to);
    // `assigned_only` sees the jobs it is on — as the jobs list and the Jobs report do.
    const own = caller.perms?.dataScope?.deals === 'assigned_only' ? caller.user.id : undefined;
    const scoped = own ? window.entries.filter((e) => e.deal.techIds.includes(own)) : window.entries;
    const filtered = scoped.filter((e) =>
      matchesItemFilters(e, e.line.productId ? window.products.get(e.line.productId) : undefined, q.filters),
    );
    return { window, scoped, filtered };
  }

  /** The rows and the Total over the filtered lines; a search narrows both, as Workiz's does. */
  private async rows(q: ItemsReportQuery, caller: ReportCaller, money: boolean) {
    const { window, scoped, filtered } = await this.filtered(q, caller);
    let { rows, totals } = aggregate(filtered, window.products, money);
    if (q.q) {
      const keys = new Set(rows.filter((r) => matchesItemSearch(r, q.q)).map((r) => r.key));
      ({ rows, totals } = aggregate(
        filtered.filter((e) => keys.has(e.line.key)),
        window.products,
        money,
      ));
    }
    return { rows, totals, window, scoped };
  }

  private window(from: string, to: string): Promise<Window> {
    const key = `${from}|${to}`;
    const now = Date.now();
    const hit = this.windows.get(key);
    if (hit && now - hit.at < WINDOW_TTL_MS) return hit.window;

    const window = this.readWindow(from, to).catch((err: unknown) => {
      this.windows.delete(key);
      if (err instanceof ReportWindowTooLargeError) throw new BadRequestException(`${err.message} — choose a shorter period`);
      throw err;
    });
    this.windows.delete(key);
    this.windows.set(key, { at: now, window });
    for (const [k, v] of this.windows) {
      if (this.windows.size <= WINDOW_CACHE_MAX && now - v.at < WINDOW_TTL_MS) break;
      this.windows.delete(k);
    }
    return window;
  }

  private async readWindow(from: string, to: string): Promise<Window> {
    const started = Date.now();
    const rows = await this.repository.readReportWindow('scheduled', from, to, ITEMS_DEAL_PROJECTION, {
      statuses: [JobSuperStatus.DONE],
    });
    const deals = rows.map(toItemsDeal).filter((d) => isCounted(d, from, to));
    if (deals.length > ITEMS_REPORT_MAX_JOBS) {
      throw new BadRequestException(`The period holds more than ${ITEMS_REPORT_MAX_JOBS} done jobs — choose a shorter period`);
    }
    const linesByDeal = await this.lines.linesOf(
      deals.map((d) => d.id),
      ITEMS_LINE_PROJECTION,
    );
    const entries: WindowLine[] = [];
    for (const deal of deals) {
      for (const row of linesByDeal.get(deal.id) ?? []) {
        const line = toItemLine(row);
        if (line) entries.push({ deal, line });
      }
    }
    const products = await this.productsFor([...new Set(entries.map((e) => e.line.productId).filter((id): id is string => !!id))]);
    this.logger.log(
      `Items report window ${from}..${to}: ${deals.length} done jobs, ${entries.length} lines, ${products.size} items in ${Date.now() - started} ms`,
    );
    return { entries, products };
  }

  /** The price book's word on each item, through a five-minute cache. */
  private async productsFor(ids: string[]): Promise<Map<string, ProductFacts>> {
    const now = Date.now();
    const out = new Map<string, ProductFacts>();
    const missing: string[] = [];
    for (const id of ids) {
      const hit = this.productCache.get(id);
      if (hit && now - hit.at < PRODUCT_TTL_MS) out.set(id, hit.facts);
      else missing.push(id);
    }
    if (missing.length) {
      const found = await this.internalHttp.getProductsForReport(missing);
      if (this.productCache.size + found.size > PRODUCT_CACHE_MAX) this.productCache.clear();
      for (const [id, product] of found) {
        const facts = productFacts({ ...product, id });
        this.productCache.set(id, { at: now, facts });
        out.set(id, facts);
      }
    }
    return out;
  }

  private namesOfUsers(ids: string[]): Promise<Map<string, string>> {
    return this.cachedNames(this.userNames, ids, (missing) => this.internalHttp.getUserNamesBatch(missing));
  }

  private namesOfClients(ids: string[]): Promise<Map<string, string>> {
    // A page is at most `pageSize` jobs; crm answers 100 a body.
    return this.cachedNames(this.clientNames, ids, async (missing) => {
      const out: PersonName[] = [];
      for (let i = 0; i < missing.length; i += 100) out.push(...(await this.internalHttp.getContactNames(missing.slice(i, i + 100))));
      return out;
    });
  }

  /** Names by id through a five-minute cache; a failed load is not remembered as "no name". */
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
        if (found.size) cache.set(id, { at: now, name });
        if (name) out.set(id, name);
      }
    }
    return out;
  }
}
