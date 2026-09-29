import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
import { invlogMonth, monthsDescending } from './inventory-log.constants';

export interface InventoryLogQuery {
  /** ISO 8601; inclusive. Defaults to the first day of the UTC month of `to`. */
  from?: string;
  /** ISO 8601; inclusive. Defaults to now. */
  to?: string;
  productId?: string;
  userId?: string;
  action?: InventoryLogAction;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface InventoryLogPageResult {
  items: InventoryLogEntry[];
  nextCursor?: string;
}

/**
 * Where a page stopped: the month partition being read and the key inside
 * it. A per-product read carries only the key — it is one Query on GSI4.
 */
interface Cursor {
  month?: string;
  lastKey?: Record<string, unknown>;
}

const DEFAULT_LIMIT = 20;

/**
 * Repository reads one list request may spend before it hands the position
 * back — the scanPage budget. A filtered walk over a busy month can otherwise
 * read on for a long time to fill one page of a rare action.
 */
const MAX_READS = 20;

@Injectable()
export class InventoryLogService {
  private readonly logger = new Logger(InventoryLogService.name);

  constructor(private readonly repository: InventoryLogRepository) {}

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
        `Inventory log entry dropped (${input.action} ${input.productId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Newest first. One product reads its own GSI4 partition; otherwise the
   * months of the window are walked from the month of `to` down to the month
   * of `from`, each read until it ends or the page is full, so a page spans
   * months the way a scanPage read spans DynamoDB pages.
   */
  async list(query: InventoryLogQuery): Promise<InventoryLogPageResult> {
    const window = this.windowOf(query);
    const filters = this.filtersOf(query);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const cursor = this.decodeCursor(query.cursor);

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
        nextCursor: page.lastKey ? this.encodeCursor({ lastKey: page.lastKey }) : undefined,
      };
    }

    const months = monthsDescending(invlogMonth(window.from), invlogMonth(window.to));
    let index = cursor?.month ? months.indexOf(cursor.month) : 0;
    if (index < 0) throw new BadRequestException('Invalid cursor');

    const items: InventoryLogEntry[] = [];
    let key = cursor?.lastKey;
    let reads = 0;

    for (; index < months.length; index++) {
      const month = months[index];

      while (items.length < limit) {
        if (reads >= MAX_READS) {
          return { items, nextCursor: this.encodeCursor({ month, lastKey: key }) };
        }
        const page = await this.repository.queryMonth(
          month,
          window,
          filters,
          limit - items.length,
          key,
        );
        reads += 1;
        items.push(...page.items);
        key = page.lastKey;
        if (!key) break;
      }

      if (items.length >= limit) {
        if (key) return { items, nextCursor: this.encodeCursor({ month, lastKey: key }) };
        // The month ended on the page boundary: the next page starts the next month.
        const next = months[index + 1];
        return { items, nextCursor: next ? this.encodeCursor({ month: next }) : undefined };
      }
    }

    return { items, nextCursor: undefined };
  }

  /** The same walk with `Select COUNT`, summed; a floor as soon as one month hit its ceiling. */
  async count(query: InventoryLogQuery): Promise<ListCount> {
    const window = this.windowOf(query);
    const filters = this.filtersOf(query);

    if (query.productId) {
      return this.repository.countProduct(query.productId, window, filters);
    }

    let total = 0;
    let atLeast = false;
    for (const month of monthsDescending(invlogMonth(window.from), invlogMonth(window.to))) {
      const part = await this.repository.countMonth(month, window, filters);
      total += part.total;
      atLeast = atLeast || part.atLeast;
    }
    return { total, atLeast };
  }

  /**
   * Both bounds canonicalised to ISO timestamps: they are compared against
   * the sort key as strings, so a date-only value must gain its time part.
   */
  private windowOf(query: InventoryLogQuery): InventoryLogWindow {
    const to = query.to ? this.toIso(query.to, 'to') : new Date().toISOString();
    const from = query.from ? this.toIso(query.from, 'from') : `${to.slice(0, 7)}-01T00:00:00.000Z`;
    if (from > to) throw new BadRequestException('`from` must not be after `to`');
    return { from, to };
  }

  private toIso(value: string, name: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`\`${name}\` is not a valid date`);
    }
    return date.toISOString();
  }

  private filtersOf(query: InventoryLogQuery): InventoryLogFilters {
    const filters: InventoryLogFilters = {};
    if (query.userId) filters.userId = query.userId;
    if (query.action) filters.action = query.action;
    if (query.search) filters.search = query.search;
    return filters;
  }

  private encodeCursor(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private decodeCursor(cursor?: string): Cursor | undefined {
    if (!cursor) return undefined;
    try {
      return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as Cursor;
    } catch {
      throw new BadRequestException('Invalid cursor');
    }
  }
}
