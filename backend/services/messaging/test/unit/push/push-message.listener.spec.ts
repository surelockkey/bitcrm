import { Subject } from 'rxjs';
import { PushMessageListener } from '../../../src/push/push-message.listener';
import { type MessagingRealtimeEvent } from '../../../src/realtime/realtime-events';

/**
 * Messages reach the notifier over the realtime bus every messaging task
 * already listens to (Redis `messaging:events` → `RealtimeSubscriber`) —
 * the same `message.upserted` frame the inbox streams. Every task hears it;
 * the notifier's claim lets one of them push.
 */
describe('PushMessageListener', () => {
  const frame = { type: 'message.upserted', at: 'x', message: { id: 'm1', conversationId: 'c1' } } as unknown as MessagingRealtimeEvent;

  function setup(enabled = true) {
    const bus = new Subject<MessagingRealtimeEvent>();
    const subscriber = { stream: jest.fn(() => bus.asObservable()) };
    const notifier = { onMessageUpserted: jest.fn(async () => ({ recipients: {} })) };
    const listener = new PushMessageListener({ enabled }, notifier as any, subscriber as any);
    return { bus, subscriber, notifier, listener };
  }

  it('hands every message.upserted frame to the notifier, nothing else', () => {
    const { bus, notifier, listener } = setup();
    listener.onModuleInit();
    bus.next(frame);
    bus.next({ type: 'counters.changed', at: 'x', counters: {} } as unknown as MessagingRealtimeEvent);
    expect(notifier.onMessageUpserted).toHaveBeenCalledTimes(1);
    expect(notifier.onMessageUpserted).toHaveBeenCalledWith(frame);
  });

  it('stops listening with the module', () => {
    const { bus, notifier, listener } = setup();
    listener.onModuleInit();
    listener.onModuleDestroy();
    bus.next(frame);
    expect(notifier.onMessageUpserted).not.toHaveBeenCalled();
  });

  it('does not listen at all while push is switched off', () => {
    const { subscriber, listener } = setup(false);
    listener.onModuleInit();
    expect(subscriber.stream).not.toHaveBeenCalled();
  });

  it('a bus that cannot be subscribed to never stops the service from booting', () => {
    const notifier = { onMessageUpserted: jest.fn() };
    const broken = { stream: jest.fn(() => { throw new TypeError('no redis'); }) };
    const listener = new PushMessageListener({ enabled: true }, notifier as any, broken as any);
    expect(() => listener.onModuleInit()).not.toThrow();
    expect(() => new PushMessageListener({ enabled: true }, notifier as any).onModuleInit()).not.toThrow();
  });
});
