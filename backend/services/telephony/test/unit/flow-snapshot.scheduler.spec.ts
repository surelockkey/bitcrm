import { FlowSnapshotScheduler } from '../../src/calls/flow-snapshot.scheduler';

/**
 * «Top Call Flows» будується вночі разом з рештою дашборда: один інстанс на
 * день за Нью-Йорком, а якщо впав — лок повертається.
 */
describe('FlowSnapshotScheduler', () => {
  function make(won = true) {
    const calls = { warmFlows: jest.fn(async () => undefined) };
    const redis = {
      client: {
        set: jest.fn(async (..._args: unknown[]) => (won ? 'OK' : null)),
        del: jest.fn(async (..._args: unknown[]) => 1),
      },
    };
    return { scheduler: new FlowSnapshotScheduler(calls as never, redis as never), calls, redis };
  }

  const now = new Date('2026-09-28T12:00:00Z');

  it('warms when it wins the day’s lock', async () => {
    const { scheduler, calls, redis } = make(true);

    await expect(scheduler.runOnce(now)).resolves.toBe(true);

    expect(calls.warmFlows).toHaveBeenCalledWith(now);
    expect(redis.client.set.mock.calls[0][0]).toBe('telephony:lock:flow-snapshot:2026-09-28');
  });

  it('another instance already did today: nothing', async () => {
    const { scheduler, calls } = make(false);

    await expect(scheduler.runOnce(now)).resolves.toBe(false);
    expect(calls.warmFlows).not.toHaveBeenCalled();
  });

  it('a failed run gives the lock back', async () => {
    const { scheduler, calls, redis } = make(true);
    calls.warmFlows.mockRejectedValueOnce(new Error('throttled'));

    await expect(scheduler.runOnce(now)).rejects.toThrow('throttled');
    expect(redis.client.del).toHaveBeenCalledWith('telephony:lock:flow-snapshot:2026-09-28');
  });

  it('the next run is 3 AM in New York', () => {
    expect(make().scheduler.delayFrom(now)).toBe(19 * 3_600_000);
  });
});
