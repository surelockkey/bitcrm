import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { type Deal } from '@bitcrm/types';
import { DealEventsBus } from './realtime/deal-events.bus';

const PREFIX = 'deal:';
const TTL = 300; // 5 minutes

@Injectable()
export class DealsCacheService {
  constructor(
    private readonly redis: RedisService,
    private readonly events: DealEventsBus,
  ) {}

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

  /**
   * Every write to a deal ends here, so this is also where open browsers
   * hear about it (`DealEventsBus`) — a new write path gets the live update
   * by invalidating like the rest.
   */
  async invalidate(id: string): Promise<void> {
    await this.redis.client.del(`${PREFIX}${id}`);
    this.events.dealChanged(id);
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
