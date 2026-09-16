import { MessageEventType, SEARCH_TYPES } from '@bitcrm/types';
import { CUSTOM_FIELD_EVENTS, EVENT_ROUTES } from 'src/indexer/event-routes';

describe('EVENT_ROUTES', () => {
  const byEvent = new Map(EVENT_ROUTES.map((r) => [r.eventType, r]));

  it('routes every message-events type that names a conversation to a conversation upsert', () => {
    for (const eventType of [
      MessageEventType.CONVERSATION_UPDATED,
      MessageEventType.MESSAGE_RECEIVED,
      MessageEventType.MESSAGE_SENT,
      MessageEventType.MESSAGE_STATUS_CHANGED,
    ]) {
      expect(byEvent.get(eventType)).toEqual({
        eventType,
        type: 'conversation',
        op: 'upsert',
        idField: 'conversationId',
      });
    }
  });

  it('does not route opt-out changes (no document carries them)', () => {
    expect(byEvent.has(MessageEventType.OPT_OUT_CHANGED)).toBe(false);
  });

  it('maps each event type once, to a known search type', () => {
    expect(byEvent.size).toBe(EVENT_ROUTES.length);
    for (const route of EVENT_ROUTES) {
      expect(SEARCH_TYPES).toContain(route.type);
      expect(CUSTOM_FIELD_EVENTS).not.toContain(route.eventType);
    }
  });
});
