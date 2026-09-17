import { queryKeys } from '../../lib/api/query-keys';
import {
  parsePushPayload,
  routeForPush,
  routeForPushData,
  staleKeysForPushData,
} from './routing';

describe('parsePushPayload', () => {
  it('reads the two shapes the backend agreed to send', () => {
    expect(parsePushPayload({ kind: 'job', dealId: 'd1' })).toEqual({
      kind: 'job',
      dealId: 'd1',
    });
    expect(
      parsePushPayload({ kind: 'conversation', conversationId: 'c1', messageId: 'm1' }),
    ).toEqual({ kind: 'conversation', conversationId: 'c1', messageId: 'm1' });
  });

  it('ignores a kind this build has never heard of', () => {
    // A phone one release behind the backend will meet exactly this, and the
    // right answer is to open the app and stop — never to throw inside a tap.
    expect(parsePushPayload({ kind: 'invoice', invoiceId: 'i1' })).toBeNull();
  });

  it('refuses a payload missing the id that gives it a destination', () => {
    expect(parsePushPayload({ kind: 'job' })).toBeNull();
    expect(parsePushPayload({ kind: 'job', dealId: '' })).toBeNull();
    expect(parsePushPayload({ kind: 'job', dealId: 42 })).toBeNull();
    expect(parsePushPayload({ kind: 'conversation', conversationId: 'c1' })).toBeNull();
  });

  it('survives anything at all arriving in place of a payload', () => {
    expect(parsePushPayload(undefined)).toBeNull();
    expect(parsePushPayload(null)).toBeNull();
    expect(parsePushPayload('a string')).toBeNull();
    expect(parsePushPayload([])).toBeNull();
  });
});

describe('routeForPush', () => {
  it('opens a job at the same path the day list pushes', () => {
    // Same route as tapping the card, so Back works the way it always does.
    expect(routeForPush({ kind: 'job', dealId: 'job-7' })).toBe('/jobs/job-7');
  });

  it('opens a conversation at the chat', () => {
    // `/chat` is the messaging stream's screen; when it lands, the
    // conversationId starts opening that one thread instead of the list.
    expect(
      routeForPush({ kind: 'conversation', conversationId: 'c1', messageId: 'm1' }),
    ).toBe('/chat');
  });
});

describe('routeForPushData', () => {
  it('goes from raw payload to route in one step', () => {
    expect(routeForPushData({ kind: 'job', dealId: 'd9' })).toBe('/jobs/d9');
  });

  it('has nowhere to send an unreadable payload', () => {
    expect(routeForPushData({ kind: 'nonsense' })).toBeNull();
    expect(routeForPushData(undefined)).toBeNull();
  });
});

describe('staleKeysForPushData', () => {
  it('marks the job and the day list out of date', () => {
    // A push about a job is news about what the list already shows. Without
    // this, the banner announces a new time over a card still showing the old
    // one — and on the job's own screen no banner goes up at all.
    expect(staleKeysForPushData({ kind: 'job', dealId: 'd9' })).toEqual([
      queryKeys.deals.lists(),
      queryKeys.deals.detail('d9'),
    ]);
  });

  it('marks the Messages list, its counts and the thread out of date', () => {
    // The Messages screen has landed, and this is the case the banner is
    // deliberately suppressed in: the technician is already looking at the
    // list. Without this the new line is invisible until the 30-second poll
    // comes round, over a screen that is being read right now.
    expect(
      staleKeysForPushData({ kind: 'conversation', conversationId: 'c1', messageId: 'm1' }),
    ).toEqual([
      queryKeys.messaging.conversations(),
      queryKeys.messaging.inboxCounters(),
      queryKeys.messaging.teamThread(),
      queryKeys.messaging.teamCounters(),
      queryKeys.messaging.messages('c1'),
    ]);
  });

  it('reloads nothing at all on a payload it cannot read', () => {
    expect(staleKeysForPushData({ kind: 'invoice', invoiceId: 'i1' })).toEqual([]);
    expect(staleKeysForPushData(undefined)).toEqual([]);
  });
});
