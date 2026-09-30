import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import type { Request } from 'express';
import { hashPortalToken } from './portal-token';

const WINDOW_SECONDS = 60;

/** Behind nginx/ALB the socket address is the proxy's; the first forwarded hop is the client. */
export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || (req.headers['x-real-ip'] as string | undefined) || req.ip || 'unknown';
}

/** Optional override of the per-minute limit (tests). */
export const PORTAL_RATE_LIMIT = 'BILLING_PORTAL_RATE_LIMIT';
/** Optional override of the per-minute limit on the PAY route (tests). */
export const PORTAL_PAY_RATE_LIMIT = 'BILLING_PORTAL_PAY_RATE_LIMIT';

/**
 * Fixed-window limiter for the public portal: N requests per IP + token per
 * minute. Keys carry a hash of the token, never the token. Fails open —
 * Redis being down must not take the portal down with it.
 */
@Injectable()
export class PortalRateLimiter {
  private readonly logger = new Logger(PortalRateLimiter.name);

  private readonly limit: number;
  private readonly payLimit: number;

  constructor(
    private readonly redis: RedisService,
    @Optional() @Inject(PORTAL_RATE_LIMIT) limit?: number,
    @Optional() @Inject(PORTAL_PAY_RATE_LIMIT) payLimit?: number,
  ) {
    this.limit = limit ?? Math.max(1, Number(process.env.BILLING_PORTAL_RATE_LIMIT) || 60);
    this.payLimit = payLimit ?? Math.max(1, Number(process.env.BILLING_PORTAL_PAY_RATE_LIMIT) || 8);
  }

  async check(ip: string, token: string): Promise<void> {
    await this.count(ip, token, 'rl', this.limit, false);
  }

  /**
   * The limiter for routes that MOVE MONEY. Tighter, and it fails CLOSED:
   * without Redis there is no way to bound how many payment attempts an
   * unauthenticated caller can make, and read-only is the safe failure.
   */
  async checkWrite(ip: string, token: string): Promise<void> {
    await this.count(ip, token, 'pay', this.payLimit, true);
  }

  private async count(ip: string, token: string, bucket: string, limit: number, failClosed: boolean): Promise<void> {
    const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
    const key = `billing:portal:${bucket}:${hashPortalToken(`${ip}|${token}`).slice(0, 32)}:${window}`;
    let count: number;
    try {
      count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, WINDOW_SECONDS);
    } catch (err) {
      this.logger.warn(`portal rate limit unavailable: ${(err as Error).message}`);
      if (!failClosed) return;
      throw new ServiceUnavailableException('Payments are briefly unavailable — please try again in a moment');
    }
    if (count > limit) {
      throw new HttpException('Too many requests — try again in a minute', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
