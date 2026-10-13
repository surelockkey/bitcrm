import { makeHarness } from './helpers/conference-harness';
import { WebhookQueue } from '../../src/common/webhook-queue';

/**
 * `/voice/outbound` returns the TwiML only after `initOutbound`. What the
 * TwiML (and the conference-events that follow it) need is the Redis meta and
 * the call record — those stay before the reply, the meta in ONE round trip.
 * The participant bookkeeping, which nothing during the call reads, moves
 * after the reply onto the call's serial queue.
 */

const flush = () => new Promise((r) => setImmediate(r));

describe('ConferenceService.initOutbound — latency', () => {
  it('writes the conference meta (+ TTL) in a single Redis round trip', async () => {
    const { service, redis } = makeHarness();
    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');
    expect(redis.roundTrips).toBe(1);
    expect(await redis.hgetall('telephony:conf:conf-CAagent1:meta')).toMatchObject({
      type: 'outbound',
      to: '+14045551234',
    });
  });

  it('the record (conferenceName set) is written BEFORE returning — other webhooks depend on it', async () => {
    const queue = new WebhookQueue();
    const { service, records } = makeHarness({ queue });
    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');
    expect(records.get('CAagent1')).toMatchObject({
      conferenceName: 'conf-CAagent1',
      status: 'initiated',
    });
    await queue.idle();
  });

  it('the caller participant is appended after returning, on the call key', async () => {
    const queue = new WebhookQueue();
    const { service, callsService } = makeHarness({ queue });
    let release!: () => void;
    (callsService.appendParticipant as jest.Mock).mockImplementationOnce(
      () => new Promise<void>((r) => (release = r)),
    );

    await service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115');
    await flush();
    expect(callsService.appendParticipant).toHaveBeenCalledWith(
      'CAagent1',
      expect.objectContaining({ userId: 'agent-1', role: 'caller' }),
    );
    expect(queue.size).toBe(1); // returned while it was still running

    // A later event for the same call waits behind it.
    const order: string[] = [];
    queue.enqueue('call:CAagent1', 'participant-join', async () => {
      order.push('join');
    });
    await flush();
    expect(order).toEqual([]);
    release();
    await queue.idle();
    expect(order).toEqual(['join']);
  });

  it('a failed participant append is logged, never fails the call', async () => {
    const queue = new WebhookQueue();
    jest.spyOn((queue as any).logger, 'error').mockImplementation(() => undefined);
    const { service, callsService } = makeHarness({ queue });
    (callsService.appendParticipant as jest.Mock).mockRejectedValueOnce(new Error('throttled'));
    await expect(
      service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115'),
    ).resolves.toBeUndefined();
    await queue.idle();
  });

  it('a Redis failure still fails initOutbound before any record is written', async () => {
    const { service, redis, applied } = makeHarness();
    redis.multi = () =>
      ({
        hset() { return this; },
        expire() { return this; },
        exec: async () => [[new Error('READONLY'), null], [null, 1]],
      }) as never;
    await expect(
      service.initOutbound('CAagent1', 'agent-1', '+14045551234', '+12624061115'),
    ).rejects.toThrow('READONLY');
    expect(applied).toHaveLength(0);
  });
});
