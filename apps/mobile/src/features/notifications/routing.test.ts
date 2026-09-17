import { parsePushPayload, routeForPush, routeForPushData } from './routing';

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
