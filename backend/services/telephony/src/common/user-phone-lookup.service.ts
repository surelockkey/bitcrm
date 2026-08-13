import { Injectable, Logger } from '@nestjs/common';

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:4001';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const CACHE_TTL_MS = 5 * 60_000;
/** Misses expire sooner — a teammate can add their number at any moment and
 *  the call log should reflect it on the next refresh, not minutes later. */
const MISS_TTL_MS = 20_000;
const MAX_BATCH = 100;

/** One of our own people, matched by their personal number. */
export interface CallUserPhone {
  id: string;
  name: string;
  roleId?: string;
}

interface CacheEntry {
  /** null caches a miss — most numbers on a call belong to nobody here. */
  user: CallUserPhone | null;
  expiresAt: number;
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
  private readonly cache = new Map<string, CacheEntry>();

  async resolve(phones: string[]): Promise<Record<string, CallUserPhone>> {
    const unique = [...new Set(phones.filter((p) => p && p.startsWith('+')))];
    const out: Record<string, CallUserPhone> = {};
    const misses: string[] = [];

    const now = Date.now();
    for (const phone of unique) {
      const hit = this.cache.get(phone);
      if (hit && hit.expiresAt > now) {
        if (hit.user) out[phone] = hit.user;
      } else {
        misses.push(phone);
      }
    }
    if (misses.length === 0) return out;

    for (let i = 0; i < misses.length; i += MAX_BATCH) {
      const batch = misses.slice(i, i + MAX_BATCH);
      const found = await this.fetchBatch(batch);
      if (!found) continue; // user-service unreachable — retry next time
      for (const phone of batch) {
        const user = found[phone] ?? null;
        this.cache.set(phone, {
          user,
          expiresAt: now + (user ? CACHE_TTL_MS : MISS_TTL_MS),
        });
        if (user) out[phone] = user;
      }
    }
    return out;
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
