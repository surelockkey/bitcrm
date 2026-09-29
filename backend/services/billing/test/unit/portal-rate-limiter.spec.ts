/* eslint-disable @typescript-eslint/no-explicit-any */
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { PortalRateLimiter, clientIp } from 'src/portal/portal-rate-limiter';

const redis = (over: Partial<Record<'incr' | 'expire', jest.Mock>> = {}) => ({
  client: {
    incr: over.incr ?? jest.fn(async () => 1),
    expire: over.expire ?? jest.fn(async () => 1),
  },
});

describe('PortalRateLimiter', () => {
  it('counts reads and writes in separate buckets', async () => {
    const r = redis();
    const limiter = new PortalRateLimiter(r as any, 60, 8);
    await limiter.check('1.2.3.4', 'tok');
    await limiter.checkWrite('1.2.3.4', 'tok');
    const [readKey] = r.client.incr.mock.calls[0];
    const [payKey] = r.client.incr.mock.calls[1];
    expect(readKey).toMatch(/:rl:/);
    expect(payKey).toMatch(/:pay:/);
    // Neither key carries the raw token.
    expect(`${readKey}${payKey}`).not.toContain('tok');
  });

  it('429s past the limit, and the pay limit is the tighter one', async () => {
    const limiter = new PortalRateLimiter(redis({ incr: jest.fn(async () => 9) }) as any, 60, 8);
    await expect(limiter.check('ip', 'tok')).resolves.toBeUndefined();
    await expect(limiter.checkWrite('ip', 'tok')).rejects.toThrow(HttpException);
  });

  it('fails OPEN on reads when Redis is down — the portal must stay readable', async () => {
    const down = redis({ incr: jest.fn(async () => { throw new Error('no redis'); }) });
    const limiter = new PortalRateLimiter(down as any, 60, 8);
    await expect(limiter.check('ip', 'tok')).resolves.toBeUndefined();
  });

  it('fails CLOSED on payments when Redis is down — an unthrottled pay route is worse', async () => {
    const down = redis({ incr: jest.fn(async () => { throw new Error('no redis'); }) });
    const limiter = new PortalRateLimiter(down as any, 60, 8);
    await expect(limiter.checkWrite('ip', 'tok')).rejects.toThrow(ServiceUnavailableException);
  });

  it('reads the client IP from the first forwarded hop', () => {
    expect(clientIp({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, ip: '10.0.0.1' } as any)).toBe('9.9.9.9');
    expect(clientIp({ headers: {}, ip: '10.0.0.2' } as any)).toBe('10.0.0.2');
    expect(clientIp({ headers: {} } as any)).toBe('unknown');
  });
});
