import { HttpException, HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { hashPortalToken } from './portal-token';

const WINDOW_SECONDS = 60;

/** Optional override of the per-minute limit (tests). */
export const PORTAL_RATE_LIMIT = 'BILLING_PORTAL_RATE_LIMIT';

/**
 * Fixed-window limiter for the public portal: N requests per IP + token per
 * minute. Keys carry a hash of the token, never the token. Fails open —
 * Redis being down must not take the portal down with it.
 */
@Injectable()
export class PortalRateLimiter {
  private readonly logger = new Logger(PortalRateLimiter.name);

  private readonly limit: number;

  constructor(
    private readonly redis: RedisService,
    @Optional() @Inject(PORTAL_RATE_LIMIT) limit?: number,
  ) {
    this.limit = limit ?? Math.max(1, Number(process.env.BILLING_PORTAL_RATE_LIMIT) || 60);
  }

  async check(ip: string, token: string): Promise<void> {
    const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const key = `billing:portal:rl:${hashPortalToken(`${ip}|${token}`).slice(0, 32)}:${window}`;
    let count: number;
    try {
      count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, WINDOW_SECONDS);
    } catch (err) {
      this.logger.warn(`portal rate limit unavailable: ${(err as Error).message}`);
      return;
    }
    if (count > this.limit) {
      throw new HttpException('Too many requests — try again in a minute', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
