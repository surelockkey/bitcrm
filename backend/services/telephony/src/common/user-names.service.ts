import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { RedisBatchCache } from './redis-batch-cache';

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:4001';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const CACHE_TTL_MS = 10 * 60_000;

/** How a system user is presented in the call log. */
export interface UserSummary {
  name: string;
  /** Lets the UI label the party with their role — "one of us", not a customer. */
  roleId?: string;
}

/**
 * Resolves system user ids to display names (and their role) through the
 * user-service internal API (`GET /api/users/internal/:id`,
 * `x-internal-secret`), cached in Redis for ten minutes (shared by every task,
 * a ten-second in-process layer in front). Resolution is
 * best-effort: an unreachable user service degrades to showing the raw id,
 * never to failing the calls endpoints.
 */
@Injectable()
export class UserNamesService {
  private readonly logger = new Logger(UserNamesService.name);
  /** By user id, shared through Redis. A failed lookup is never cached. */
  private readonly cache: RedisBatchCache<UserSummary>;

  constructor(@Optional() redis?: RedisService) {
    this.cache = new RedisBatchCache<UserSummary>(redis, 'telephony:names:user:v1', {
      hitTtlMs: CACHE_TTL_MS,
      // Nothing caches a miss here: an unknown id is an error, not an answer.
      missTtlMs: 0,
    });
  }

  async resolve(userIds: string[]): Promise<Record<string, UserSummary>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return {};
    const found = await this.cache.getMany(unique, async (misses) => {
      const loaded = new Map<string, UserSummary | null>();
      await Promise.all(
        misses.map(async (id) => {
          const user = await this.fetchUser(id);
          if (user) loaded.set(id, user);
        }),
      );
      return loaded;
    });
    return Object.fromEntries(found);
  }

  private async fetchUser(id: string): Promise<UserSummary | null> {
    try {
      const res = await fetch(`${USER_SERVICE_URL}/api/users/internal/${id}`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: {
          firstName?: string;
          lastName?: string;
          email?: string;
          roleId?: string;
        };
      };
      const u = body.data;
      if (!u) return null;
      const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      const name = full || u.email;
      return name ? { name, roleId: u.roleId } : null;
    } catch (error) {
      this.logger.warn(
        `name lookup failed for ${id}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
