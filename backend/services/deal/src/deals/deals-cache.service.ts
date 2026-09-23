import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type Deal } from '@bitcrm/types';

const PREFIX = 'deal:';
const TTL = 300; // 5 minutes

@Injectable()
export class DealsCacheService {
  constructor(private readonly redis: RedisService) {}

  async get(id: string): Promise<Deal | null> {
    const data = await this.redis.client.get(`${PREFIX}${id}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(deal: Deal): Promise<void> {
    await this.redis.client.set(
      `${PREFIX}${deal.id}`,
      JSON.stringify(deal),
      'EX',
      TTL,
    );
  }

  async invalidate(id: string): Promise<void> {
    await this.redis.client.del(`${PREFIX}${id}`);
  }

  /** A short-lived JSON value under its own key — the tab counts, for one. */
  async getJson<T>(key: string): Promise<T | null> {
    const data = await this.redis.client.get(key);
    return data ? (JSON.parse(data) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }
}
