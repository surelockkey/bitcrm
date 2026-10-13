import { WebhookQueue } from '../../src/common/webhook-queue';

const flush = () => new Promise((r) => setImmediate(r));

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('WebhookQueue', () => {
  it('runs jobs for one key strictly in arrival order', async () => {
    const queue = new WebhookQueue();
    const order: string[] = [];
    const first = deferred();

    queue.enqueue('call:CA1', 'a', async () => {
      await first.promise;
      order.push('a');
    });
    queue.enqueue('call:CA1', 'b', async () => {
      order.push('b');
    });
    await flush();
    expect(order).toEqual([]); // b waits for a

    first.resolve();
    await queue.idle();
    expect(order).toEqual(['a', 'b']);
  });

  it('different keys do not wait for each other', async () => {
    const queue = new WebhookQueue();
    const order: string[] = [];
    const blocked = deferred();
    queue.enqueue('call:CA1', 'slow', async () => {
      await blocked.promise;
      order.push('slow');
    });
    queue.enqueue('call:CA2', 'fast', async () => {
      order.push('fast');
    });
    await flush();
    expect(order).toEqual(['fast']);
    blocked.resolve();
    await queue.idle();
  });

  it('a failing job is logged, never thrown, and does not stop the next one', async () => {
    const queue = new WebhookQueue();
    const warn = jest.spyOn((queue as any).logger, 'error').mockImplementation(() => undefined);
    const ran: string[] = [];

    const failed = queue.enqueue('call:CA1', 'conference-events participant-join', async () => {
      throw new Error('dynamo throttled');
    });
    queue.enqueue('call:CA1', 'next', async () => {
      ran.push('next');
    });
    await expect(failed.done).resolves.toBeUndefined();
    await queue.idle();

    expect(ran).toEqual(['next']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dynamo throttled'));
    expect(warn.mock.calls[0][0]).toContain('conference-events participant-join');
  });

  it('forgets a key once its chain is drained (bounded memory)', async () => {
    const queue = new WebhookQueue();
    queue.enqueue('call:CA1', 'a', async () => undefined);
    await queue.idle();
    expect(queue.size).toBe(0);
    expect((queue as any).tails.size).toBe(0);
  });

  it('over the limit it asks the caller to wait (backpressure) instead of growing', async () => {
    const queue = new WebhookQueue(2);
    const gate = deferred();
    const a = queue.enqueue('k1', 'a', () => gate.promise);
    const b = queue.enqueue('k2', 'b', () => gate.promise);
    const c = queue.enqueue('k3', 'c', () => gate.promise);
    expect(a.overloaded).toBe(false);
    expect(b.overloaded).toBe(false);
    expect(c.overloaded).toBe(true);
    gate.resolve();
    await queue.idle();
  });

  it('drains on shutdown, bounded by a deadline', async () => {
    const queue = new WebhookQueue();
    const ran: string[] = [];
    queue.enqueue('k', 'a', async () => {
      await flush();
      ran.push('a');
    });
    await queue.onModuleDestroy();
    expect(ran).toEqual(['a']);

    const stuck = deferred();
    queue.enqueue('k', 'stuck', () => stuck.promise);
    const started = Date.now();
    await (queue as any).drain(30);
    expect(Date.now() - started).toBeLessThan(1000);
    stuck.resolve();
    await queue.idle();
  });
});
