import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BusinessMetricsService, tryNormalizePhone } from '@bitcrm/shared';
import { BLOCKED_CALLER_LIMITS, type BlockedCaller } from '@bitcrm/types';
import { BlockedCallersRepository } from './blocked-callers.repository';
import { type BlockCallerDto } from './dto/block-caller.dto';

/**
 * How long one read of the list serves the inbound checks. Every inbound
 * call and (through the internal route) every inbound text asks; a Query per
 * webhook would be the busiest read in the service for a list that changes a
 * few times a month.
 *
 * A write clears only this task's copy: a number blocked on one task is still
 * let through by another for up to this long — there are two tasks during a
 * rolling deploy — which is the trade for not reading the table on every call.
 */
export const BLOCKED_CACHE_TTL_MS = 15_000;

export interface ListBlockedCallersParams {
  /** Digits of a number or words of a comment. */
  q?: string;
  page?: number | string;
  limit?: number | string;
}

export interface BlockedCallersPage {
  data: BlockedCaller[];
  pagination: { total: number; page: number; limit: number; pages: number };
}

@Injectable()
export class BlockedCallersService {
  private readonly logger = new Logger(BlockedCallersService.name);
  private cache: { rows: BlockedCaller[]; expiresAt: number } | null = null;

  constructor(
    private readonly repository: BlockedCallersRepository,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
  ) {}

  /* ------------------------------------------------------------ reading */

  /**
   * The list as Workiz shows it: oldest first, paged, searched by the digits
   * of a number or the words of a comment. Served from the same cached read
   * the inbound check uses.
   */
  async list(params: ListBlockedCallersParams = {}): Promise<BlockedCallersPage> {
    const rows = await this.rows();
    const q = (params.q ?? '').trim();
    const digits = q.replace(/\D/g, '');
    const words = q.toLowerCase();
    const found = q
      ? rows.filter(
          (r) =>
            (digits.length > 0 && r.number.replace(/\D/g, '').includes(digits)) ||
            (words.length > 0 && (r.comment ?? '').toLowerCase().includes(words)),
        )
      : rows;
    const sorted = [...found].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.number.localeCompare(b.number),
    );

    const limitRaw = Number(params.limit);
    const limit =
      Number.isFinite(limitRaw) && limitRaw >= 1
        ? Math.min(Math.floor(limitRaw), BLOCKED_CALLER_LIMITS.listMaxLimit)
        : BLOCKED_CALLER_LIMITS.listDefaultLimit;
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const pageRaw = Number(params.page);
    const page = Math.min(Math.max(1, Number.isFinite(pageRaw) ? Math.floor(pageRaw) : 1), pages);
    const start = (page - 1) * limit;
    return { data: sorted.slice(start, start + limit), pagination: { total, page, limit, pages } };
  }

  /**
   * The inbound check. Never throws and fails open: a table that does not
   * answer blocks nobody (the caller rings through, as before this existed)
   * rather than taking the line down. Our own softphone legs (`client:…`)
   * and an empty From are never blocked.
   */
  async isBlocked(from: string | undefined, now: number = Date.now()): Promise<boolean> {
    if (!from || from.startsWith('client:')) return false;
    const canonical = tryNormalizePhone(from);
    if (!canonical) return false;
    try {
      const rows = await this.rows(now);
      return rows.some((r) => r.number === canonical);
    } catch (error) {
      this.logger.error(
        `Blocked-caller check failed for ${from} — letting it through: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  /** Every blocked number, E.164 — what messaging reads over the internal route. */
  async numbers(): Promise<string[]> {
    return (await this.rows()).map((r) => r.number);
  }

  /* ------------------------------------------------------------ writing */

  async block(dto: BlockCallerDto, caller: { id: string }): Promise<BlockedCaller> {
    const number = this.validNumber(dto?.number);
    const comment = this.validComment(dto?.comment);
    const row: BlockedCaller = {
      id: randomUUID(),
      number,
      ...(comment ? { comment } : {}),
      createdBy: caller.id,
      createdAt: new Date().toISOString(),
    };
    try {
      await this.repository.create(row);
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new ConflictException(`${number} is already blocked`);
      }
      throw error;
    }
    this.cache = null;
    this.businessMetrics?.entityCreated?.inc({ entity_type: 'blocked_caller' });
    this.logger.log(`${number} blocked by ${caller.id}`);
    return row;
  }

  async unblock(rawNumber: string, caller: { id: string }): Promise<{ number: string; deleted: true }> {
    const number = this.validNumber(rawNumber);
    const existed = await this.repository.remove(number);
    this.cache = null;
    if (!existed) throw new NotFoundException(`${number} is not blocked`);
    this.businessMetrics?.entityDeleted?.inc({ entity_type: 'blocked_caller' });
    this.logger.log(`${number} unblocked by ${caller.id}`);
    return { number, deleted: true };
  }

  /* ------------------------------------------------------------ private */

  /**
   * The list, memoised for BLOCKED_CACHE_TTL_MS. A read that fails keeps the
   * last good list if there is one (stale beats blind), and throws otherwise
   * — `isBlocked` turns that into "not blocked", `list` into a 500.
   */
  private async rows(now: number = Date.now()): Promise<BlockedCaller[]> {
    if (this.cache && this.cache.expiresAt > now) return this.cache.rows;
    try {
      const rows = await this.repository.listAll();
      this.cache = { rows, expiresAt: now + BLOCKED_CACHE_TTL_MS };
      return rows;
    } catch (error) {
      if (this.cache) {
        this.logger.warn(
          `Blocked-caller list read failed, serving the last one: ${error instanceof Error ? error.message : error}`,
        );
        return this.cache.rows;
      }
      throw error;
    }
  }

  /* No ValidationPipe in this service — the DTO decorators are inert. */

  private validNumber(raw: unknown): string {
    const text = typeof raw === 'string' ? raw.trim() : '';
    const canonical = text ? tryNormalizePhone(text) : null;
    if (!canonical) throw new BadRequestException('number must be a dialable phone number');
    return canonical;
  }

  private validComment(raw: unknown): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'string') throw new BadRequestException('comment must be text');
    const comment = raw.trim();
    if (comment.length > BLOCKED_CALLER_LIMITS.commentMaxLength) {
      throw new BadRequestException(
        `comment must be at most ${BLOCKED_CALLER_LIMITS.commentMaxLength} characters`,
      );
    }
    return comment || undefined;
  }
}
