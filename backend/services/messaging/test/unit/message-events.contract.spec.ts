import { MessageEventType, MESSAGE_EVENT_TOPIC } from '@bitcrm/types';

/**
 * Locks the wire format of the message-events contract. A change here is a
 * breaking change for every consumer (search-service today) and must be made
 * deliberately, together with EVENTS.md.
 */
describe('message-events contract', () => {
  it('publishes on the message-events topic key', () => {
    expect(MESSAGE_EVENT_TOPIC).toBe('message-events');
  });

  it('has stable event-type strings', () => {
    expect(MessageEventType).toEqual({
      MESSAGE_RECEIVED: 'message.received',
      MESSAGE_SENT: 'message.sent',
      MESSAGE_STATUS_CHANGED: 'message.status_changed',
      CONVERSATION_UPDATED: 'conversation.updated',
      OPT_OUT_CHANGED: 'opt_out.changed',
    });
  });
});
