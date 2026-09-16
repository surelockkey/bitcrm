import { OutboundEventsPublisher } from '../../../src/outbound/outbound-events';
import { createMockConversation, createMockMessage, T1 } from '../mocks';

/** The SNS side of the outbound path: payload shapes, and silence without a publisher. */
describe('OutboundEventsPublisher', () => {
  it('messageReceived carries the thread’s party for a team / group in-app line (§6)', async () => {
    const sns = { publish: jest.fn().mockResolvedValue(undefined) };
    const publisher = new OutboundEventsPublisher(sns as never);
    const m = createMockMessage({ id: 'm7', conversationId: 'g1', channel: 'in_app', from: undefined, to: undefined, providerSid: undefined, dealId: 'd1', createdAt: T1 });
    await publisher.messageReceived(m, createMockConversation({ id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1' }));
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'message.received', {
      messageId: 'm7',
      conversationId: 'g1',
      channel: 'in_app',
      from: undefined,
      to: undefined,
      partyKind: 'group',
      partyId: 'g1',
      dealId: 'd1',
      providerSid: undefined,
      createdAt: T1,
    });
  });

  it('a failing or missing publisher never throws', async () => {
    const sns = { publish: jest.fn().mockRejectedValue(new Error('sns down')) };
    await expect(new OutboundEventsPublisher(sns as never).messageReceived(createMockMessage(), createMockConversation())).resolves.toBeUndefined();
    await expect(new OutboundEventsPublisher().messageReceived(createMockMessage(), createMockConversation())).resolves.toBeUndefined();
  });
});
