import { Injectable, Logger } from '@nestjs/common';

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:4001';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const CACHE_TTL_MS = 10 * 60_000;

interface CacheEntry {
  name: string;
  expiresAt: number;
}

/**
 * Resolves system user ids to display names through the user-service internal
 * API (`GET /api/users/internal/:id`, `x-internal-secret`) with a small
 * in-memory cache. Resolution is best-effort: an unreachable user service
 * degrades to showing the raw id, never to failing the calls endpoints.
 */
@Injectable()
export class UserNamesService {
  private readonly logger = new Logger(UserNamesService.name);
  private readonly cache = new Map<string, CacheEntry>();

  async resolve(userIds: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const out: Record<string, string> = {};
    const misses: string[] = [];

    const now = Date.now();
    for (const id of unique) {
      const hit = this.cache.get(id);
      if (hit && hit.expiresAt > now) out[id] = hit.name;
      else misses.push(id);
    }

    await Promise.all(
      misses.map(async (id) => {
        const name = await this.fetchName(id);
        if (name) {
          this.cache.set(id, { name, expiresAt: now + CACHE_TTL_MS });
          out[id] = name;
        }
      }),
    );
    return out;
  }

  private async fetchName(id: string): Promise<string | null> {
    try {
      const res = await fetch(`${USER_SERVICE_URL}/api/users/internal/${id}`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: { firstName?: string; lastName?: string; email?: string };
      };
      const u = body.data;
      if (!u) return null;
      const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
      return full || u.email || null;
    } catch (error) {
      this.logger.warn(
        `name lookup failed for ${id}: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
