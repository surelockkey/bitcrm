import { RealtimePublisher } from '../../../src/realtime/realtime.publisher';
import { createMockConversation, createMockMessage, T1 } from '../mocks';
import { mockRedis } from './realtime-mocks';

describe('RealtimePublisher', () => {
  it('publishes the serialised event on messaging:events', () => {
    const { redis, client } = mockRedis();
    const event = { type: 'counters.changed' as const, at: T1, counters: { unreadConversations: 1, flaggedConversations: 0, unreadByKind: {} } };
    new RealtimePublisher(redis).publish(event);
    expect(client.publish).toHaveBeenCalledWith('messaging:events', JSON.stringify(event));
  });

  it('the helpers stamp the type and time and carry the unmasked entity', () => {
    const { redis, client } = mockRedis();
    const publisher = new RealtimePublisher(redis);
    const c = createMockConversation();
    const m = createMockMessage();

    publisher.conversationUpserted(c, T1);
    publisher.messageUpserted(m, c, T1);
    publisher.countersChanged({ unreadConversations: 2, flaggedConversations: 1, unreadByKind: { client: 2 } }, T1);
    publisher.optOutChanged({ channel: 'sms', address: '+14045551234', status: 'opted_out', conversationId: 'c1' }, T1);

    const sent = client.publish.mock.calls.map((call) => JSON.parse(call[1]));
    expect(sent[0]).toEqual({ type: 'conversation.upserted', at: T1, conversation: c });
    expect(sent[1]).toEqual({ type: 'message.upserted', at: T1, message: m, conversation: c });
    expect(sent[1].message.from).toBe('+14045551234'); // masking is the viewer's problem
    expect(sent[2]).toEqual({ type: 'counters.changed', at: T1, counters: { unreadConversations: 2, flaggedConversations: 1, unreadByKind: { client: 2 } } });
    expect(sent[3]).toEqual({ type: 'opt_out.changed', at: T1, channel: 'sms', address: '+14045551234', status: 'opted_out', conversationId: 'c1' });
  });

  it('a team / group delivery adds recipients and mentions to message.upserted (§6)', () => {
    const { redis, client } = mockRedis();
    const m = createMockMessage({ channel: 'in_app', mentions: ['u3'] });
    new RealtimePublisher(redis).messageUpserted(m, undefined, T1, { recipients: ['u2', 'u3'], mentions: ['u3'] });
    expect(JSON.parse(client.publish.mock.calls[0][1])).toEqual({ type: 'message.upserted', at: T1, message: m, recipients: ['u2', 'u3'], mentions: ['u3'] });
  });

  it('stamps "now" when no time is given', () => {
    const { redis, client } = mockRedis();
    new RealtimePublisher(redis).conversationUpserted(createMockConversation());
    const at = JSON.parse(client.publish.mock.calls[0][1]).at;
    expect(new Date(at).toISOString()).toBe(at);
  });

  it('a Redis failure is swallowed (fire-and-forget)', async () => {
    const { redis, client } = mockRedis();
    client.publish.mockRejectedValue(new Error('redis down'));
    expect(() => new RealtimePublisher(redis).conversationUpserted(createMockConversation())).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });
});
