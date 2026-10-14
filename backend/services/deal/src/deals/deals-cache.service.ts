import { Injectable, Logger } from '@nestjs/common';
import { RedisService, failOpen } from '@bitcrm/shared';
import { type Deal } from '@bitcrm/types';
import { DealEventsBus } from './realtime/deal-events.bus';

const PREFIX = 'deal:';
/**
 * Bumped on every job write (`invalidate`): the dispatch map's cached answers
 * carry it in their key (`DispatchMapService`), so a write is never hidden.
 */
export const DISPATCH_MAP_GENERATION_KEY = 'deal:map:gen';
const TTL = 300; // 5 minutes

@Injectable()
export class DealsCacheService {
  private readonly logger = new Logger(DealsCacheService.name);
  /** Redis gone (a deploy's outgoing task, a failover): a miss, or a dropped write — the TTL bounds staleness. */
  private readonly lost = (error: Error) => this.logger.warn(`cache unavailable: ${error.message}`);

  constructor(
    private readonly redis: RedisService,
    private readonly events: DealEventsBus,
  ) {}

  async get(id: string): Promise<Deal | null> {
    const data = await failOpen(() => this.redis.client.get(`${PREFIX}${id}`), null, this.lost);
    if (!data) return null;
    return JSON.parse(data);
  }

  async set(deal: Deal): Promise<void> {
    await failOpen(
      () => this.redis.client.set(`${PREFIX}${deal.id}`, JSON.stringify(deal), 'EX', TTL),
      null,
      this.lost,
    );
  }

  /**
   * Every write to a deal ends here, so this is also where open browsers
   * hear about it (`DealEventsBus`) — a new write path gets the live update
   * by invalidating like the rest.
   */
  async invalidate(id: string): Promise<void> {
    await failOpen(() => this.redis.client.del(`${PREFIX}${id}`), 0, this.lost);
    // The dispatch map's cached answers are keyed by this generation: the next read misses.
    try {
      await this.redis.client.incr?.(DISPATCH_MAP_GENERATION_KEY);
    } catch {
      /* the map's 10 s TTL bounds it anyway */
    }
    this.events.dealChanged(id);
  }

  /** A short-lived JSON value under its own key — the tab counts, for one. */
  async getJson<T>(key: string): Promise<T | null> {
    const data = await failOpen(() => this.redis.client.get(key), null, this.lost);
    return data ? (JSON.parse(data) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await failOpen(() => this.redis.client.set(key, JSON.stringify(value), 'EX', ttlSeconds), null, this.lost);
  }
}
