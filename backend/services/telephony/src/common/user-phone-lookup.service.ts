import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { RedisBatchCache } from './redis-batch-cache';

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:4001';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const CACHE_TTL_MS = 10 * 60_000;
/** Misses expire sooner — most numbers on a call belong to nobody here, and a
 *  teammate adding their number shows through within five minutes. */
const MISS_TTL_MS = 5 * 60_000;
const MAX_BATCH = 100;

/** One of our own people, matched by their personal number. */
export interface CallUserPhone {
  id: string;
  name: string;
  roleId?: string;
}

/**
 * Resolves phone numbers to system users through the user-service internal API
 * (`POST /api/users/internal/by-phones`, `x-internal-secret`).
 *
 * This is what lets the log say "we rang Nazarii on his mobile" instead of
 * showing an unknown number: the person is on the call as a phone endpoint,
 * not as a softphone participant, so nothing else in the record identifies
 * them. Best-effort and cached, like the contact lookup beside it.
 */
@Injectable()
export class UserPhoneLookupService {
  private readonly logger = new Logger(UserPhoneLookupService.name);
  /** By number, shared through Redis; `null` caches a miss. */
  private readonly cache: RedisBatchCache<CallUserPhone>;

  constructor(@Optional() redis?: RedisService) {
    this.cache = new RedisBatchCache<CallUserPhone>(redis, 'telephony:names:user-phone:v1', {
      hitTtlMs: CACHE_TTL_MS,
      missTtlMs: MISS_TTL_MS,
    });
  }

  async resolve(phones: string[]): Promise<Record<string, CallUserPhone>> {
    const unique = [...new Set(phones.filter((p) => p && p.startsWith('+')))];
    if (!unique.length) return {};
    const found = await this.cache.getMany(unique, async (misses) => {
      const loaded = new Map<string, CallUserPhone | null>();
      for (let i = 0; i < misses.length; i += MAX_BATCH) {
        const batch = misses.slice(i, i + MAX_BATCH);
        const answer = await this.fetchBatch(batch);
        if (!answer) continue; // user-service unreachable — retry next time
        for (const phone of batch) loaded.set(phone, answer[phone] ?? null);
      }
      return loaded;
    });
    return Object.fromEntries(found);
  }

  private async fetchBatch(
    phones: string[],
  ): Promise<Record<string, CallUserPhone> | null> {
    try {
      const res = await fetch(
        `${USER_SERVICE_URL}/api/users/internal/by-phones`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-secret': INTERNAL_SECRET,
          },
          body: JSON.stringify({ phones }),
        },
      );
      if (!res.ok) {
        this.logger.warn(`user phone lookup returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        data?: Record<
          string,
          { id: string; firstName?: string; lastName?: string; roleId?: string }
        >;
      };
      const out: Record<string, CallUserPhone> = {};
      for (const [phone, u] of Object.entries(body.data ?? {})) {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        out[phone] = { id: u.id, name: name || 'Teammate', roleId: u.roleId };
      }
      return out;
    } catch (error) {
      this.logger.warn(
        `user phone lookup failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
