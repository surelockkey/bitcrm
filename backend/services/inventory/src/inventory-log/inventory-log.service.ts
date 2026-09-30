import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService, cachedCount, countCacheKey, type CountRowsResult } from '@bitcrm/shared';
import {
  type InventoryLogAction,
  type InventoryLogEntry,
  type ListCount,
} from '@bitcrm/types';
import {
  InventoryLogRepository,
  type InventoryLogFilters,
  type InventoryLogWindow,
} from './inventory-log.repository';
import { invlogMonth } from './inventory-log.constants';
import {
  encodeCursor,
  monthsDescending,
  monthsSpanned,
  parseCursor,
  walkMonths,
} from '../common/utils/month-walk';

export interface InventoryLogQuery {
  /** ISO 8601; inclusive. Defaults to the first day of the UTC month of `to`. */
  from?: string;
  /** ISO 8601; inclusive — a date alone means the whole of that UTC day. Defaults to now. */
  to?: string;
  productId?: string;
  userId?: string;
  action?: InventoryLogAction;
  search?: string;
  limit?: number;
  cursor?: string;
}

/** What the caller may see besides the entries themselves. */
export interface InventoryLogReadOptions {
  /**
   * `financials.view`: the entries keep `unitCost`. Without it the server
   * leaves costs out (the owner's money rule); `unitPrice` always stays.
   */
  money?: boolean;
}

export interface InventoryLogPageResult {
  items: InventoryLogEntry[];
  nextCursor?: string;
}

/**
 * Where a page stopped, and the window it was read under. The default window
 * ends "now" and moves between two requests — across midnight on the last
 * day of a month, page two would look at a month page one never saw — so a
 * cursor carries its own bounds and the next page is read against them.
 * A month-walk cursor names the month partition and the key inside it; a
 * per-product cursor carries only the GSI4 key.
 */
interface Cursor {
  month?: string;
  lastKey?: Record<string, unknown>;
  from: string;
  to: string;
}

const DEFAULT_LIMIT = 20;

/**
 * DynamoDB reads one list request may spend before it hands the position
 * back — the scanPage budget, shared across the months a page spans. A
 * filtered walk over a busy month can otherwise read on for a long time to
 * fill one page of a rare action.
 */
const MAX_READS = 20;

/**
 * How far apart `from` and `to` may be. Every month of the window is one
 * partition to Query — for the list, for the count, and for each filter
 * keystroke that recounts — so the window is capped rather than the caller
 * trusted with `from=1970-01-01`. Deal stats cap theirs at 92 days for the
 * same reason; a log report is monthly, so its cap is in months.
 */
const MAX_WINDOW_MONTHS = 24;

/** How long a list count stays good enough. Matches the other inventory counts. */
const COUNT_TTL_SECONDS = 30;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** An entry as a caller without `financials.view` may see it: no company cost. */
function withoutCost(entry: InventoryLogEntry): InventoryLogEntry {
  const { unitCost: _unitCost, ...rest } = entry;
  return rest;
}
const MONTH = /^\d{4}-\d{2}$/;

@Injectable()
export class InventoryLogService {
  private readonly logger = new Logger(InventoryLogService.name);

  constructor(
    private readonly repository: InventoryLogRepository,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * Best effort by design: an entry describes a write that already happened,
   * so a failed entry is a warning, never a failed product edit or stock move.
   */
  async record(input: Omit<InventoryLogEntry, 'id' | 'createdAt'>): Promise<void> {
    const entry: InventoryLogEntry = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    try {
      await this.repository.create(entry);
    } catch (err) {
      this.logger.warn(
        `Inventory log entry dropped (${input.action} ${input.productId ?? input.subjectUserId}): ` +
          (err as Error).message,
      );
    }
  }

  /**
   * The newest `stock_used` entry of an item for a job — where its units came
   * from, so a restore puts them back there. Null when the log has none.
   */
  lastStockUse(productId: string, dealId: string): Promise<InventoryLogEntry | null> {
    return this.repository.findLatestStockUse(productId, dealId);
  }

  /**
   * Newest first. One product reads its own GSI4 partition; otherwise the
   * months of the window are walked from the month of `to` down to the month
   * of `from`, each read until it ends or the page is full, so a page spans
   * months the way a scanPage read spans DynamoDB pages.
   */
  async list(
    query: InventoryLogQuery,
    options: InventoryLogReadOptions = {},
  ): Promise<InventoryLogPageResult> {
    const page = await this.readPage(query);
    if (options.money) return page;
    return { ...page, items: page.items.map(withoutCost) };
  }

  private async readPage(query: InventoryLogQuery): Promise<InventoryLogPageResult> {
    const cursor = this.decodeCursor(query.cursor, query.productId ? 'product' : 'months');
    const window = cursor ? this.assertWindow({ from: cursor.from, to: cursor.to }) : this.windowOf(query);
    const filters = this.filtersOf(query);
    const limit = query.limit ?? DEFAULT_LIMIT;

    if (query.productId) {
      const page = await this.repository.queryProduct(
        query.productId,
        window,
        filters,
        limit,
        cursor?.lastKey,
      );
      return {
        items: page.items,
        nextCursor: page.lastKey
          ? this.encodeCursor({ lastKey: page.lastKey, ...window })
          : undefined,
      };
    }

    const months = monthsDescending(invlogMonth(window.from), invlogMonth(window.to));
    const { items, next } = await walkMonths(
      months,
      (month, pageLimit, startKey, maxReads) =>
        this.repository.queryMonth(month, window, filters, pageLimit, startKey, maxReads),
      {
        limit,
        maxReads: MAX_READS,
        ...(cursor?.month && { start: { month: cursor.month, lastKey: cursor.lastKey } }),
      },
    );
    return { items, nextCursor: next ? this.encodeCursor({ ...next, ...window }) : undefined };
  }

  /**
   * The same walk with `Select COUNT`, summed, behind a short cache — the
   * number the panel turns into "Page 2 of 7". A floor as soon as one month
   * hit its ceiling, and the walk stops there: the months below could only
   * raise a number that is already "at least".
   */
  async count(query: InventoryLogQuery): Promise<ListCount> {
    const window = this.windowOf(query);
    const filters = this.filtersOf(query);

    const take = async (): Promise<CountRowsResult> => {
      if (query.productId) {
        return this.repository.countProduct(query.productId, window, filters);
      }

      let total = 0;
      for (const month of monthsDescending(invlogMonth(window.from), invlogMonth(window.to))) {
        const part = await this.repository.countMonth(month, window, filters);
        total += part.total;
        if (part.atLeast) return { total, atLeast: true };
      }
      return { total, atLeast: false };
    };

    if (!this.redis) return take();
    // Keyed on the query as given, not the resolved window: the default window
    // ends "now", and a key that changes every millisecond caches nothing.
    const { from, to, productId, userId, action, search } = query;
    return cachedCount(
      this.redis.client,
      countCacheKey('inventory-log', { from, to, productId, userId, action, search }),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  /**
   * Both bounds canonicalised to ISO timestamps: they are compared against
   * the sort key as strings, so a date-only value must gain its time part —
   * the start of the day for `from`, the end of it for `to`, since both are
   * inclusive and "to the 10th" means the whole of the 10th.
   */
  private windowOf(query: InventoryLogQuery): InventoryLogWindow {
    const to = query.to ? this.toIso(query.to, 'to') : new Date().toISOString();
    const from = query.from ? this.toIso(query.from, 'from') : `${to.slice(0, 7)}-01T00:00:00.000Z`;
    return this.assertWindow({ from, to });
  }

  private assertWindow(window: InventoryLogWindow): InventoryLogWindow {
    if (window.from > window.to) throw new BadRequestException('`from` must not be after `to`');
    if (this.monthsApart(window) > MAX_WINDOW_MONTHS) {
      throw new BadRequestException(`\`from\` and \`to\` may span at most ${MAX_WINDOW_MONTHS} months`);
    }
    return window;
  }

  /** How many month partitions the window touches — arithmetic, so a year like 0001 cannot loop. */
  private monthsApart(window: InventoryLogWindow): number {
    return monthsSpanned(invlogMonth(window.from), invlogMonth(window.to));
  }

  private toIso(value: string, name: 'from' | 'to'): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`\`${name}\` is not a valid date`);
    }
    const iso = date.toISOString();
    if (name === 'to' && DATE_ONLY.test(value)) return `${iso.slice(0, 10)}T23:59:59.999Z`;
    return iso;
  }

  private filtersOf(query: InventoryLogQuery): InventoryLogFilters {
    const filters: InventoryLogFilters = {};
    if (query.userId) filters.userId = query.userId;
    if (query.action) filters.action = query.action;
    if (query.search) filters.search = query.search;
    return filters;
  }

  private encodeCursor(cursor: Cursor): string {
    return encodeCursor(cursor);
  }

  /**
   * A cursor is only ever one this service minted, for the same kind of read:
   * a month-walk key fed to the GSI4 Query (or the other way round) is a
   * DynamoDB ValidationException and a 500, so the shape is checked here and
   * a mismatch is a 400 before anything is read.
   */
  private decodeCursor(raw: string | undefined, mode: 'months' | 'product'): Cursor | undefined {
    if (!raw) return undefined;

    const cursor = parseCursor(raw) as Partial<Cursor>;
    const lastKey = cursor.lastKey;
    const validKey =
      lastKey === undefined || (typeof lastKey === 'object' && lastKey !== null && !Array.isArray(lastKey));
    const validWindow = typeof cursor.from === 'string' && typeof cursor.to === 'string';
    const fitsMode =
      mode === 'product'
        ? cursor.month === undefined && (lastKey === undefined || typeof lastKey.GSI4PK === 'string')
        : typeof cursor.month === 'string' &&
          MONTH.test(cursor.month) &&
          (lastKey === undefined || lastKey.GSI4PK === undefined);
    if (!validKey || !validWindow || !fitsMode) throw new BadRequestException('Invalid cursor');

    return cursor as Cursor;
  }
}
