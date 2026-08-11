import { Injectable } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';

/**
 * Tracks which agents are "online" (softphone registered) so inbound calls can
 * be routed to them. Backed by a Redis sorted set scored by expiry timestamp:
 * an agent stays online only as long as the browser keeps heart-beating, so a
 * closed tab or crash ages out automatically.
 */
@Injectable()
export class PresenceService {
  private readonly key = 'telephony:online';
  /**
   * How long an online mark survives without a heartbeat. Generous on purpose:
   * the browser's heartbeat timer gets throttled to ~once/minute in background
   * tabs, but the Twilio Device WebSocket stays connected and can still receive
   * calls — so a tight TTL would drop presence for agents who are actually
   * reachable. 5 min comfortably outlives background throttling; a cleanly
   * closed tab clears presence immediately via setOffline().
   */
  private readonly ttlMs = 5 * 60_000;

  constructor(private readonly redis: RedisService) {}

  /** Mark an agent online (or refresh their heartbeat). */
  async setOnline(identity: string, now: number = Date.now()): Promise<void> {
    await this.redis.client.zadd(this.key, now + this.ttlMs, identity);
  }

  /** Mark an agent offline (explicit toggle-off / logout). */
  async setOffline(identity: string): Promise<void> {
    await this.redis.client.zrem(this.key, identity);
  }

  /** The identities of all currently-online agents (expired ones pruned). */
  async listOnline(now: number = Date.now()): Promise<string[]> {
    await this.redis.client.zremrangebyscore(this.key, 0, now);
    return this.redis.client.zrange(this.key, 0, -1);
  }
}
