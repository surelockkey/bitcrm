/**
 * Who is using the platform right now (Admin → Users "Online"): every signed-in
 * request, from the web or the app, stamps the user's last-seen time in one
 * Redis sorted set — at most once a minute per user per process, and never at
 * the cost of the request.
 */
import { USER_LAST_SEEN_KEY, UserActivityTracker } from '../../../src/auth/user-activity';

function makeRedis() {
  return {
    client: {
      zadd: jest.fn().mockResolvedValue(1),
      zrange: jest.fn().mockResolvedValue([]),
      zremrangebyscore: jest.fn().mockResolvedValue(0),
    },
  };
}

const T0 = Date.parse('2026-10-12T15:00:00Z');

describe('UserActivityTracker.touch', () => {
  it('stamps the user with the time of the request', () => {
    const redis = makeRedis();
    new UserActivityTracker(redis as never).touch('u-1', T0);

    expect(redis.client.zadd).toHaveBeenCalledWith(USER_LAST_SEEN_KEY, T0, 'u-1');
  });

  it('writes at most once a minute per user', () => {
    const redis = makeRedis();
    const tracker = new UserActivityTracker(redis as never);

    tracker.touch('u-1', T0);
    tracker.touch('u-1', T0 + 30_000);
    tracker.touch('u-2', T0 + 30_000);
    tracker.touch('u-1', T0 + 60_000);

    expect(redis.client.zadd.mock.calls).toEqual([
      [USER_LAST_SEEN_KEY, T0, 'u-1'],
      [USER_LAST_SEEN_KEY, T0 + 30_000, 'u-2'],
      [USER_LAST_SEEN_KEY, T0 + 60_000, 'u-1'],
    ]);
  });

  it('a failed write never fails the request, and is tried again on the next one', async () => {
    const redis = makeRedis();
    redis.client.zadd.mockRejectedValueOnce(new Error('redis down'));
    const tracker = new UserActivityTracker(redis as never);

    expect(() => tracker.touch('u-1', T0)).not.toThrow();
    await new Promise((r) => setImmediate(r));
    tracker.touch('u-1', T0 + 1_000);

    expect(redis.client.zadd).toHaveBeenCalledTimes(2);
  });

  it('ignores a request without a user id', () => {
    const redis = makeRedis();
    new UserActivityTracker(redis as never).touch('', T0);
    expect(redis.client.zadd).not.toHaveBeenCalled();
  });
});

describe('UserActivityTracker.lastSeen', () => {
  it('reads every user’s last-seen time, dropping stamps older than half a year', async () => {
    const redis = makeRedis();
    redis.client.zrange.mockResolvedValue(['u-1', String(T0 - 60_000), 'u-2', String(T0)]);

    const seen = await new UserActivityTracker(redis as never).lastSeen(T0);

    expect(redis.client.zremrangebyscore).toHaveBeenCalledWith(USER_LAST_SEEN_KEY, 0, T0 - 183 * 24 * 3600_000);
    expect(redis.client.zrange).toHaveBeenCalledWith(USER_LAST_SEEN_KEY, 0, -1, 'WITHSCORES');
    expect(seen).toEqual(new Map([['u-1', T0 - 60_000], ['u-2', T0]]));
  });
});
