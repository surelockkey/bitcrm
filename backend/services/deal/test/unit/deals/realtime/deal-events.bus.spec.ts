import { EventEmitter } from 'events';
import { DEAL_EVENTS_CHANNEL, DealEventsBus, type DealEvent } from 'src/deals/realtime/deal-events.bus';

function createRedis() {
  const subscriber = Object.assign(new EventEmitter(), {
    subscribe: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK'),
  });
  const client = {
    publish: jest.fn().mockResolvedValue(1),
    duplicate: jest.fn(() => subscriber),
  };
  return { redis: { client }, client, subscriber };
}

describe('DealEventsBus', () => {
  it('publishes deal.changed with the id onto the deal channel', () => {
    const { redis, client } = createRedis();
    const bus = new DealEventsBus(redis as never);

    bus.dealChanged('deal-1', '2026-09-25T10:00:00.000Z');

    expect(client.publish).toHaveBeenCalledWith(
      DEAL_EVENTS_CHANNEL,
      JSON.stringify({ type: 'deal.changed', dealId: 'deal-1', at: '2026-09-25T10:00:00.000Z' }),
    );
  });

  it('never throws when Redis refuses the publish', async () => {
    const { redis, client } = createRedis();
    client.publish.mockRejectedValue(new Error('down'));
    const bus = new DealEventsBus(redis as never);

    expect(() => bus.dealChanged('deal-1')).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });

  it('relays channel messages to every stream on one dedicated subscriber connection', () => {
    const { redis, client, subscriber } = createRedis();
    const bus = new DealEventsBus(redis as never);
    const a: DealEvent[] = [];
    const b: DealEvent[] = [];

    bus.stream().subscribe((e) => a.push(e));
    bus.stream().subscribe((e) => b.push(e));
    const event = { type: 'deal.changed', dealId: 'deal-1', at: 'now' };
    subscriber.emit('message', DEAL_EVENTS_CHANNEL, JSON.stringify(event));

    expect(client.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith(DEAL_EVENTS_CHANNEL);
    expect(a).toEqual([event]);
    expect(b).toEqual([event]);
  });

  it('drops malformed and unknown frames', () => {
    const { redis, subscriber } = createRedis();
    const bus = new DealEventsBus(redis as never);
    const seen: DealEvent[] = [];
    bus.stream().subscribe((e) => seen.push(e));

    subscriber.emit('message', DEAL_EVENTS_CHANNEL, 'not json');
    subscriber.emit('message', DEAL_EVENTS_CHANNEL, JSON.stringify({ type: 'call.upserted' }));
    subscriber.emit('message', DEAL_EVENTS_CHANNEL, JSON.stringify({ type: 'deal.changed' }));

    expect(seen).toEqual([]);
  });

  it('closes the subscriber connection with the module', async () => {
    const { redis, subscriber } = createRedis();
    const bus = new DealEventsBus(redis as never);
    bus.stream();

    await bus.onModuleDestroy();

    expect(subscriber.quit).toHaveBeenCalled();
  });
});
