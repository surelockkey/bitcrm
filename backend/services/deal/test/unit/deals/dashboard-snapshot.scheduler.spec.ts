import { DashboardSnapshotScheduler } from 'src/deals/dashboard/dashboard-snapshot.scheduler';

/**
 * Нічний прогрів дашборда. Кожен інстанс сервісу його планує, але робить один:
 * Redis `SET NX` на день за Нью-Йорком. Той самий лок пускає й прогрів одразу
 * після деплою — якщо сьогодні знімків ще не будували.
 */
describe('DashboardSnapshotScheduler', () => {
  function make(won = true) {
    const dashboard = { warm: jest.fn(async () => undefined) };
    const redis = {
      client: {
        set: jest.fn(async (..._args: unknown[]) => (won ? 'OK' : null)),
        del: jest.fn(async (..._args: unknown[]) => 1),
      },
    };
    const scheduler = new DashboardSnapshotScheduler(dashboard as never, redis as never);
    return { scheduler, dashboard, redis };
  }

  // 08:00 in New York, Sep 28.
  const now = new Date('2026-09-28T12:00:00Z');

  it('warms when it wins the day’s lock', async () => {
    const { scheduler, dashboard, redis } = make(true);

    await expect(scheduler.runOnce(now)).resolves.toBe(true);

    expect(dashboard.warm).toHaveBeenCalledWith(now);
    const [key, , ex, ttl, nx] = redis.client.set.mock.calls[0] as unknown as [string, string, string, number, string];
    expect(key).toBe('deal:lock:dashboard-snapshot:2026-09-28');
    expect([ex, nx]).toEqual(['EX', 'NX']);
    expect(ttl).toBeGreaterThanOrEqual(20 * 3600);
  });

  it('the lock is the New York day — at 11pm there it is still that day', async () => {
    const { scheduler, redis } = make(true);

    await scheduler.runOnce(new Date('2026-09-29T03:00:00Z'));

    expect(redis.client.set.mock.calls[0][0]).toBe('deal:lock:dashboard-snapshot:2026-09-28');
  });

  it('another instance already did today: nothing', async () => {
    const { scheduler, dashboard } = make(false);

    await expect(scheduler.runOnce(now)).resolves.toBe(false);

    expect(dashboard.warm).not.toHaveBeenCalled();
  });

  it('a failed run gives the lock back, so the next try is not locked out for a day', async () => {
    const { scheduler, dashboard, redis } = make(true);
    dashboard.warm.mockRejectedValueOnce(new Error('DynamoDB throttled'));

    await expect(scheduler.runOnce(now)).rejects.toThrow('DynamoDB throttled');

    expect(redis.client.del).toHaveBeenCalledWith('deal:lock:dashboard-snapshot:2026-09-28');
  });

  it('the next run is 3 AM in New York', () => {
    const { scheduler } = make();

    // 08:00 EDT → 03:00 EDT tomorrow.
    expect(scheduler.delayFrom(now)).toBe(19 * 3_600_000);
  });
});
