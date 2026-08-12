import { Injectable, Logger } from '@nestjs/common';

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

interface CacheEntry {
  user: UserSummary;
  expiresAt: number;
}

/**
 * Resolves system user ids to display names (and their role) through the
 * user-service internal API (`GET /api/users/internal/:id`,
 * `x-internal-secret`) with a small in-memory cache. Resolution is
 * best-effort: an unreachable user service degrades to showing the raw id,
 * never to failing the calls endpoints.
 */
@Injectable()
export class UserNamesService {
  private readonly logger = new Logger(UserNamesService.name);
  private readonly cache = new Map<string, CacheEntry>();

  async resolve(userIds: string[]): Promise<Record<string, UserSummary>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const out: Record<string, UserSummary> = {};
    const misses: string[] = [];

    const now = Date.now();
    for (const id of unique) {
      const hit = this.cache.get(id);
      if (hit && hit.expiresAt > now) out[id] = hit.user;
      else misses.push(id);
    }

    await Promise.all(
      misses.map(async (id) => {
        const user = await this.fetchUser(id);
        if (user) {
          this.cache.set(id, { user, expiresAt: now + CACHE_TTL_MS });
          out[id] = user;
        }
      }),
    );
    return out;
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
