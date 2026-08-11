import { RedisService } from '@bitcrm/shared';
import { CallEventsBus, type CallEvent } from '../../src/calls/call-events.bus';

function makeBus() {
  const handlers = new Map<string, (channel: string, message: string) => void>();
  const subscriber = {
    subscribe: jest.fn().mockResolvedValue(1),
    on: jest.fn().mockImplementation((event: string, cb: any) => {
      handlers.set(event, cb);
    }),
    quit: jest.fn().mockResolvedValue('OK'),
  };
  const client = {
    publish: jest.fn().mockResolvedValue(1),
    duplicate: jest.fn().mockReturnValue(subscriber),
  };
  const bus = new CallEventsBus({ client } as unknown as RedisService);
  return { bus, client, subscriber, handlers };
}

const EVENT: CallEvent = {
  type: 'call.upserted',
  call: {
    callSid: 'CA1',
    startedAt: '2026-08-05T10:00:00.000Z',
    updatedAt: '2026-08-05T10:00:00.000Z',
  },
};

describe('CallEventsBus', () => {
  it('publishes events onto the redis channel', () => {
    const { bus, client } = makeBus();
    bus.publish(EVENT);
    expect(client.publish).toHaveBeenCalledWith(
      'telephony:call-events',
      JSON.stringify(EVENT),
    );
  });

  it('fans redis messages out to stream subscribers (lazy single subscriber)', () => {
    const { bus, client, handlers } = makeBus();
    const seen: CallEvent[] = [];
    bus.stream().subscribe((e) => seen.push(e));
    bus.stream().subscribe((e) => seen.push(e));

    // one duplicated connection regardless of subscriber count
    expect(client.duplicate).toHaveBeenCalledTimes(1);

    handlers.get('message')?.('telephony:call-events', JSON.stringify(EVENT));
    expect(seen).toHaveLength(2);
    expect(seen[0].call.callSid).toBe('CA1');
  });

  it('survives malformed messages', () => {
    const { bus, handlers } = makeBus();
    const seen: CallEvent[] = [];
    bus.stream().subscribe((e) => seen.push(e));
    handlers.get('message')?.('telephony:call-events', 'not-json{');
    handlers.get('message')?.('telephony:call-events', JSON.stringify(EVENT));
    expect(seen).toHaveLength(1);
  });

  it('closes the subscriber connection on module destroy', async () => {
    const { bus, subscriber } = makeBus();
    bus.stream().subscribe(() => undefined);
    await bus.onModuleDestroy();
    expect(subscriber.quit).toHaveBeenCalled();
  });
});
