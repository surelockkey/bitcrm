import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { cachedCount, countCacheKey, RedisService, type CountRowsResult } from '@bitcrm/shared';
import {
  accountDaysBetween,
  ACTIVITY_DEFAULT_PAGE_SIZE,
  ACTIVITY_EXPORT_MAX_ROWS,
  ACTIVITY_MAX_USERS,
  type ActivityExport,
  type ActivityRow,
  type ActivitySort,
} from '@bitcrm/types';
import { ActivityRepository, type ActivityCursor } from './activity.repository';
import { ActivityCountsRepository } from './activity-counts.repository';
import { activityRowOf, isImported } from './activity-index';
import type { ActivityQueryDto } from './dto/activity-query.dto';

/** How long a count stays good enough — as long as the lists' counts. */
const COUNT_TTL_SECONDS = 60;
/** The export's page size and ceiling on pages walked. */
const EXPORT_PAGE = 100;
const EXPORT_MAX_PAGES = 400;

interface Normalized {
  from: string;
  to: string;
  sort: ActivitySort;
  limit: number;
  q?: string;
  userIds?: string[];
}

/**
 * Workiz Reports → Activity: the account's journal of who did what, off the
 * timeline rows' Activity indexes. Pages walk forward on a cursor; the total
 * is the days' counters when nothing narrows the period, a bounded count
 * otherwise (cached a minute).
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly repo: ActivityRepository,
    private readonly counts: ActivityCountsRepository,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async list(query: ActivityQueryDto): Promise<{ items: ActivityRow[]; nextCursor?: string }> {
    const q = this.normalize(query);
    const qDealId = q.q ? await this.repo.dealIdByNumber(q.q.trim()) : undefined;
    const page = await this.repo.page({ ...q, qDealId, cursor: decodeCursor(query.cursor) });
    return { items: await this.rows(page.items), nextCursor: encodeCursor(page.next) };
  }

  async count(query: ActivityQueryDto): Promise<CountRowsResult> {
    const q = this.normalize(query);
    const take = async (): Promise<CountRowsResult> => {
      if (!q.q && !q.userIds?.length) {
        return { total: await this.counts.sum(accountDaysBetween(q.from, q.to)), atLeast: false };
      }
      const qDealId = q.q ? await this.repo.dealIdByNumber(q.q.trim()) : undefined;
      return this.repo.count({ from: q.from, to: q.to, q: q.q, qDealId, userIds: q.userIds });
    };
    if (!this.redis) return take();
    return cachedCount(
      this.redis.client,
      countCacheKey('activity', { from: q.from, to: q.to, q: q.q, users: q.userIds?.join(',') }),
      COUNT_TTL_SECONDS,
      take,
    );
  }

  /** Every matching row up to Workiz's ceiling, for the CSV. */
  async export(query: ActivityQueryDto): Promise<ActivityExport> {
    const q = this.normalize({ ...query, limit: EXPORT_PAGE });
    const qDealId = q.q ? await this.repo.dealIdByNumber(q.q.trim()) : undefined;
    const rows: ActivityRow[] = [];
    let cursor: ActivityCursor | undefined;
    for (let pages = 0; pages < EXPORT_MAX_PAGES; pages += 1) {
      const page = await this.repo.page({ ...q, qDealId, cursor });
      rows.push(...(await this.rows(page.items)));
      if (rows.length >= ACTIVITY_EXPORT_MAX_ROWS) {
        return { rows: rows.slice(0, ACTIVITY_EXPORT_MAX_ROWS), truncated: rows.length > ACTIVITY_EXPORT_MAX_ROWS || !!page.next };
      }
      if (!page.next) return { rows, truncated: false };
      cursor = page.next;
    }
    return { rows, truncated: true };
  }

  private async rows(items: Record<string, unknown>[]): Promise<ActivityRow[]> {
    // Our own events name their job by id only; its code is the deal's number.
    const native = items
      .filter((it) => !isImported(it) && typeof it.dealId === 'string')
      .map((it) => it.dealId as string);
    const numbers = native.length ? await this.repo.dealNumbers(native) : new Map<string, string>();
    return items.map((it) => activityRowOf(it, typeof it.dealId === 'string' ? numbers.get(it.dealId) : undefined));
  }

  private normalize(query: ActivityQueryDto): Normalized {
    const { from, to } = query;
    if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw new BadRequestException('from and to are YYYY-MM-DD days');
    }
    if (to < from) throw new BadRequestException('The period must start on or before it ends');
    const userIds = (query.userIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (userIds.length > ACTIVITY_MAX_USERS) {
      throw new BadRequestException(`Filter by at most ${ACTIVITY_MAX_USERS} users`);
    }
    const text = (query.q ?? '').trim().toLowerCase();
    return {
      from,
      to,
      sort: query.sort === 'asc' ? 'asc' : 'desc',
      limit: Math.min(Math.max(Number(query.limit) || ACTIVITY_DEFAULT_PAGE_SIZE, 1), 100),
      ...(text && { q: text }),
      ...(userIds.length && { userIds: [...new Set(userIds)] }),
    };
  }
}

export function encodeCursor(cursor?: ActivityCursor): string | undefined {
  return cursor ? Buffer.from(JSON.stringify(cursor)).toString('base64url') : undefined;
}

export function decodeCursor(raw?: string): ActivityCursor | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8')) as ActivityCursor;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    throw new BadRequestException('cursor is not one this list handed out');
  }
}
