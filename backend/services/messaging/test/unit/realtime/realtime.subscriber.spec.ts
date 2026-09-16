import { type MessagingRealtimeEvent } from '../../../src/realtime/realtime-events';
import { RealtimeSubscriber } from '../../../src/realtime/realtime.subscriber';
import { createMockConversation, T1 } from '../mocks';
import { mockRedis } from './realtime-mocks';

const EVENT: MessagingRealtimeEvent = { type: 'conversation.upserted', at: T1, conversation: createMockConversation() };

describe('RealtimeSubscriber', () => {
  it('duplicates one connection lazily and fans messages out to every stream subscriber', () => {
    const { redis, client, subscriber, emit } = mockRedis();
    const bus = new RealtimeSubscriber(redis);
    expect(client.duplicate).not.toHaveBeenCalled();

    const seen: MessagingRealtimeEvent[] = [];
    bus.stream().subscribe((e) => seen.push(e));
    bus.stream().subscribe((e) => seen.push(e));
    expect(client.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith('messaging:events');

    emit(JSON.stringify(EVENT));
    expect(seen).toHaveLength(2);
    expect(seen[0].type).toBe('conversation.upserted');
  });

  it('drops malformed JSON and unknown event types', () => {
    const { redis, emit } = mockRedis();
    const bus = new RealtimeSubscriber(redis);
    const seen: MessagingRealtimeEvent[] = [];
    bus.stream().subscribe((e) => seen.push(e));
    emit('not-json{');
    emit(JSON.stringify({ type: 'call.upserted', call: {} }));
    emit(JSON.stringify(EVENT));
    expect(seen).toHaveLength(1);
  });

  it('closes the subscriber connection on module destroy', async () => {
    const { redis, subscriber } = mockRedis();
    const bus = new RealtimeSubscriber(redis);
    bus.stream().subscribe(() => undefined);
    await bus.onModuleDestroy();
    expect(subscriber.quit).toHaveBeenCalled();
  });
});
