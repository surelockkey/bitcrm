import {
  ASK_AFTER_OPENS,
  foregroundBehavior,
  permissionDecision,
  type AskInputs,
} from './policy';

const inputs = (over: Partial<AskInputs> = {}): AskInputs => ({
  opens: 1,
  alreadyAsked: false,
  permission: { granted: false, canAskAgain: true },
  ...over,
});

describe('permissionDecision', () => {
  it('does not ask on a technician’s first open', () => {
    // An OS dialog before they know what the app is, is a question about
    // nothing — and on iOS it is the only one they will ever get.
    expect(permissionDecision(inputs({ opens: 1 }))).toBe('wait');
  });

  it('asks once they have come back to it', () => {
    expect(permissionDecision(inputs({ opens: ASK_AFTER_OPENS }))).toBe('ask');
    expect(permissionDecision(inputs({ opens: ASK_AFTER_OPENS + 5 }))).toBe('ask');
  });

  it('never asks twice', () => {
    expect(permissionDecision(inputs({ opens: 9, alreadyAsked: true }))).toBe('never');
  });

  it('takes "no" for an answer', () => {
    expect(
      permissionDecision(
        inputs({ opens: 9, permission: { granted: false, canAskAgain: false } }),
      ),
    ).toBe('never');
  });

  it('skips the question entirely when permission is already there', () => {
    // Every later open: register the token, say nothing.
    expect(
      permissionDecision(
        inputs({ opens: 1, permission: { granted: true, canAskAgain: false } }),
      ),
    ).toBe('already-granted');
    expect(
      permissionDecision(
        inputs({ opens: 40, alreadyAsked: true, permission: { granted: true, canAskAgain: true } }),
      ),
    ).toBe('already-granted');
  });
});

describe('foregroundBehavior', () => {
  const job = { kind: 'job', dealId: 'd1' };
  const chat = { kind: 'conversation', conversationId: 'c1', messageId: 'm1' };

  it('shows a banner and nothing louder', () => {
    const behavior = foregroundBehavior(job, '/');
    expect(behavior).toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      // The phone is already in their hand; the OS makes the noise when it is
      // in a pocket, which is the case where noise is the only thing that works.
      shouldPlaySound: false,
      // A badge count this app cannot count would be a number that is wrong.
      shouldSetBadge: false,
    });
  });

  it('stays silent about the screen the technician is already looking at', () => {
    // A "new message" banner over the very thread showing that message covers
    // the thing it is announcing.
    expect(foregroundBehavior(chat, '/chat')).toEqual({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
    expect(foregroundBehavior(job, '/jobs/d1').shouldShowBanner).toBe(false);
  });

  it('still announces a different job while one job is open', () => {
    expect(foregroundBehavior(job, '/jobs/d2').shouldShowBanner).toBe(true);
  });

  it('ignores a trailing slash when deciding it is the same screen', () => {
    expect(foregroundBehavior(job, '/jobs/d1/').shouldShowBanner).toBe(false);
  });

  it('falls back to showing a payload it cannot read', () => {
    // It came from our own server and says something; the technician can judge.
    expect(foregroundBehavior({ kind: 'mystery' }, '/').shouldShowBanner).toBe(true);
    expect(foregroundBehavior(undefined, undefined).shouldShowBanner).toBe(true);
  });
});
