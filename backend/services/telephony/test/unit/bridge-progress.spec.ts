import {
  BRIDGE_REASONS,
  clientLegProgress,
  nextProgress,
  technicianLegProgress,
} from '../../src/common/bridge-progress';

/**
 * What the phone tells the technician after "Call client". Each status
 * callback of the two legs moves the bridge along one way:
 *
 *   ringing_you → you_answered → connecting_client → connected → ended
 *
 * or stops it at `failed` with a reason a technician can act on. The owner's
 * test on 2026-10-14 is the case that started it: four bridges, every one
 * `failed` (a Ukrainian technician number the dev account may not call, a
 * fictional client number), and the phone said nothing at all.
 */
describe('technicianLegProgress — the technician’s own handset', () => {
  it('ringing (and the statuses before it) is "ringing your phone"', () => {
    for (const CallStatus of ['queued', 'initiated', 'ringing']) {
      expect(technicianLegProgress({ CallStatus }, 'ringing_you')).toEqual({ state: 'ringing_you' });
    }
  });

  it('in-progress means the technician picked up — not that the client is on', () => {
    expect(technicianLegProgress({ CallStatus: 'in-progress' }, 'ringing_you')).toEqual({
      state: 'you_answered',
    });
  });

  it('no-answer and busy say so', () => {
    expect(technicianLegProgress({ CallStatus: 'no-answer' }, 'ringing_you')).toEqual({
      state: 'failed',
      reason: 'Your phone did not answer',
    });
    expect(technicianLegProgress({ CallStatus: 'busy' }, 'ringing_you')).toEqual({
      state: 'failed',
      reason: 'Your phone was busy',
    });
  });

  it('a plain failure is "your number could not be reached"', () => {
    expect(technicianLegProgress({ CallStatus: 'failed' }, 'ringing_you')).toEqual({
      state: 'failed',
      reason: 'Your number could not be reached',
    });
  });

  it.each(['13227', '21215', '32205'])(
    'geo-permission error %s blames the company line, not the phone',
    (ErrorCode) => {
      expect(technicianLegProgress({ CallStatus: 'failed', ErrorCode }, 'ringing_you')).toEqual({
        state: 'failed',
        reason: 'Your number could not be reached from the company line',
      });
    },
  );

  it.each(['13224', '21211', '13223'])('invalid-number error %s does too', (ErrorCode) => {
    expect(technicianLegProgress({ CallStatus: 'failed', ErrorCode }, 'ringing_you')).toEqual({
      state: 'failed',
      reason: 'Your number could not be reached from the company line',
    });
  });

  it('reads busy and no-answer out of the SIP response of a failed leg', () => {
    expect(
      technicianLegProgress({ CallStatus: 'failed', SipResponseCode: '486' }, 'ringing_you'),
    ).toEqual({ state: 'failed', reason: 'Your phone was busy' });
    expect(
      technicianLegProgress({ CallStatus: 'failed', SipResponseCode: '480' }, 'ringing_you'),
    ).toEqual({ state: 'failed', reason: 'Your phone did not answer' });
  });

  it('completed after the client was dialled is the call ending', () => {
    expect(technicianLegProgress({ CallStatus: 'completed' }, 'connecting_client')).toEqual({
      state: 'ended',
    });
    expect(technicianLegProgress({ CallStatus: 'completed' }, 'connected')).toEqual({
      state: 'ended',
    });
  });

  /**
   * No key press any more (2026-10-15): Twilio's answering-machine detection
   * decides, and a voicemail box is hung up before the client is dialled.
   * The completed callback carries the same `AnsweredBy`.
   */
  it.each(['machine_start', 'machine_end_beep', 'fax'])(
    'completed before the client was dialled, answered by %s, is the voicemail outcome',
    (AnsweredBy) => {
      expect(
        technicianLegProgress({ CallStatus: 'completed', AnsweredBy }, 'you_answered'),
      ).toEqual({
        state: 'failed',
        reason: 'Your voicemail answered, so the client was not called',
      });
      expect(BRIDGE_REASONS.voicemail).toBe('Your voicemail answered, so the client was not called');
    },
  );

  it('completed before the client was dialled, by a person, is them hanging up — not a failure', () => {
    // The technician answered and put the phone down while it was still
    // listening: nothing went wrong, so nothing is reported as a failure.
    for (const AnsweredBy of ['human', 'unknown', undefined]) {
      expect(
        technicianLegProgress({ CallStatus: 'completed', AnsweredBy }, 'you_answered'),
      ).toEqual({ state: 'ended' });
    }
  });

  it('never blames a missing key press any more', () => {
    expect(Object.values(BRIDGE_REASONS).join(' ')).not.toMatch(/key/i);
  });

  it('canceled is the Cancel button, not a failure', () => {
    expect(technicianLegProgress({ CallStatus: 'canceled' }, 'ringing_you')).toEqual({
      state: 'ended',
    });
  });

  it('ignores a status it does not know', () => {
    expect(technicianLegProgress({ CallStatus: 'sideways' }, 'ringing_you')).toBeNull();
    expect(technicianLegProgress({}, 'ringing_you')).toBeNull();
  });
});

describe('clientLegProgress — the leg that dials the client', () => {
  it('answered is connected; completed or canceled is the end', () => {
    expect(clientLegProgress({ CallStatus: 'in-progress' })).toEqual({ state: 'connected' });
    expect(clientLegProgress({ CallStatus: 'completed' })).toEqual({ state: 'ended' });
    expect(clientLegProgress({ CallStatus: 'canceled' })).toEqual({ state: 'ended' });
  });

  it('ringing is still "connecting you to the client"', () => {
    expect(clientLegProgress({ CallStatus: 'ringing' })).toEqual({ state: 'connecting_client' });
  });

  it('no-answer, busy and failed each say what happened at the client’s end', () => {
    expect(clientLegProgress({ CallStatus: 'no-answer' })).toEqual({
      state: 'failed',
      reason: 'The client did not answer',
    });
    expect(clientLegProgress({ CallStatus: 'busy' })).toEqual({
      state: 'failed',
      reason: "The client's line is busy",
    });
    expect(clientLegProgress({ CallStatus: 'failed' })).toEqual({
      state: 'failed',
      reason: "The client's number could not be reached",
    });
  });

  it('a failed leg with a busy SIP response is a busy line', () => {
    expect(clientLegProgress({ CallStatus: 'failed', SipResponseCode: '486' })).toEqual({
      state: 'failed',
      reason: "The client's line is busy",
    });
  });
});

describe('nextProgress — the bridge only moves forward', () => {
  it('takes a later stage', () => {
    expect(nextProgress({ state: 'ringing_you' }, { state: 'you_answered' })).toEqual({
      state: 'you_answered',
    });
    expect(nextProgress({ state: 'you_answered' }, { state: 'connected' })).toEqual({
      state: 'connected',
    });
  });

  it('drops an earlier or equal stage that arrives late (webhooks race)', () => {
    expect(nextProgress({ state: 'connecting_client' }, { state: 'you_answered' })).toBeNull();
    expect(nextProgress({ state: 'ringing_you' }, { state: 'ringing_you' })).toBeNull();
  });

  it('the first terminal outcome wins', () => {
    const failed = { state: 'failed' as const, reason: 'The client did not answer' };
    expect(nextProgress({ state: 'connecting_client' }, failed)).toEqual(failed);
    expect(nextProgress(failed, { state: 'ended' })).toBeNull();
    expect(nextProgress({ state: 'ended' }, failed)).toBeNull();
  });
});
