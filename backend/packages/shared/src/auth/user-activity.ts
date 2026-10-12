import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/** One sorted set: member = user id, score = the epoch ms of their last signed-in request. */
export const USER_LAST_SEEN_KEY = 'users:last-seen';

/** A user is stamped at most this often per process — the web's heartbeat is a minute. */
export const USER_ACTIVITY_THROTTLE_MS = 60_000;

/** Stamps older than this are dropped on read: half a year is "never" for "Last seen". */
const KEEP_MS = 183 * 24 * 3600_000;

/**
 * When each user last used the platform — Admin → Users "Online" / "Last
 * seen". `CognitoAuthGuard` touches it on every signed-in request in every
 * service, so the web and the app both count; user-service reads it.
 *
 * Fire-and-forget: a Redis that is down costs a stale "Last seen", never a
 * request. The throttle is per process and in memory (a team is hundreds of
 * people), so a busy page costs one ZADD a minute per user, not one per call.
 */
@Injectable()
export class UserActivityTracker {
  private readonly logger = new Logger(UserActivityTracker.name);
  private readonly written = new Map<string, number>();

  constructor(private readonly redis: RedisService) {}

  touch(userId: string, now: number = Date.now()): void {
    if (!userId) return;
    const last = this.written.get(userId);
    if (last !== undefined && now - last < USER_ACTIVITY_THROTTLE_MS) return;
    this.written.set(userId, now);
    this.redis.client.zadd(USER_LAST_SEEN_KEY, now, userId).catch((error: Error) => {
      // Let the next request try again.
      this.written.delete(userId);
      this.logger.warn(`Last-seen stamp failed: ${error.message}`);
    });
  }

  /** Every user's last-seen time (epoch ms), the long-gone ones pruned first. */
  async lastSeen(now: number = Date.now()): Promise<Map<string, number>> {
    await this.redis.client.zremrangebyscore(USER_LAST_SEEN_KEY, 0, now - KEEP_MS);
    const flat = await this.redis.client.zrange(USER_LAST_SEEN_KEY, 0, -1, 'WITHSCORES');
    const seen = new Map<string, number>();
    for (let i = 0; i + 1 < flat.length; i += 2) seen.set(flat[i], Number(flat[i + 1]));
    return seen;
  }
}
