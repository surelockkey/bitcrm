import { ApiError } from '../api/errors';
import { MAX_NON_IDEMPOTENT_ATTEMPTS, RETRY_SCHEDULE_MS } from '../api/retry';
import {
  canDiscardSilently,
  isIdempotent,
  isReady,
  isSweepable,
  outcomeAfterFailure,
  retryPatch,
  selectNextBatch,
  shouldRepresign,
} from './policy';
import type { OutboxRecord } from './types';

const NOW = 1_700_000_000_000;

const row = (over: Partial<OutboxRecord> = {}): OutboxRecord => ({
  id: 'r1',
  kind: 'note',
  dealId: 'd1',
  payload: '{}',
  createdAt: NOW,
  attempts: 0,
  nextAttemptAt: NOW,
  lastError: null,
  state: 'pending',
  ...over,
});

describe('isIdempotent', () => {
  it('lets the stamps and the automatic texts be replayed', () => {
    expect(isIdempotent('confirm')).toBe(true);
    expect(isIdempotent('arrived')).toBe(true);
    expect(isIdempotent('on_my_way')).toBe(true);
    expect(isIdempotent('late')).toBe(true);
  });

  it('does not, for the two the server would genuinely duplicate', () => {
    expect(isIdempotent('note')).toBe(false);
    expect(isIdempotent('status')).toBe(false);
  });
});

describe('isReady', () => {
  it('waits out a backoff', () => {
    expect(isReady(row({ nextAttemptAt: NOW + 1 }), NOW)).toBe(false);
    expect(isReady(row({ nextAttemptAt: NOW }), NOW)).toBe(true);
  });

  it('ignores rows that are in flight, parked or already sent', () => {
    for (const state of ['sending', 'failed', 'done'] as const) {
      expect(isReady(row({ state }), NOW)).toBe(false);
    }
  });
});

describe('selectNextBatch', () => {
  it('takes the oldest ready row of each job, and only one per job', () => {
    const batch = selectNextBatch(
      [
        row({ id: 'a2', dealId: 'd1', createdAt: NOW + 2 }),
        row({ id: 'a1', dealId: 'd1', createdAt: NOW + 1 }),
        row({ id: 'b1', dealId: 'd2', createdAt: NOW + 3 }),
      ],
      NOW + 10,
    );
    expect(batch.map((r) => r.id)).toEqual(['a1', 'b1']);
  });

  it('leaves a job alone while one of its rows is already in flight', () => {
    // Order within a job matters: "arrived", then the status move, then the
    // note. Sending two at once would let them land the wrong way round.
    const batch = selectNextBatch(
      [
        row({ id: 'inflight', dealId: 'd1', state: 'sending' }),
        row({ id: 'next', dealId: 'd1', createdAt: NOW + 1 }),
        row({ id: 'other', dealId: 'd2' }),
      ],
      NOW + 10,
    );
    expect(batch.map((r) => r.id)).toEqual(['other']);
  });

  it('breaks a same-millisecond tie deterministically', () => {
    const batch = selectNextBatch(
      [
        row({ id: 'b', dealId: 'd1' }),
        row({ id: 'a', dealId: 'd2' }),
        row({ id: 'c', dealId: 'd3' }),
      ],
      NOW,
    );
    expect(batch.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('takes nothing when everything is still waiting out its backoff', () => {
    expect(selectNextBatch([row({ nextAttemptAt: NOW + 5_000 })], NOW)).toEqual([]);
  });
});

describe('outcomeAfterFailure', () => {
  it('does not count a dead network against the budget, and stays ready', () => {
    const out = outcomeAfterFailure(
      row({ attempts: 3 }),
      new ApiError(0, 'no signal'),
      'no signal',
      NOW,
      () => 0.5,
      false,
    );
    // A basement is not a reason to give up on a note.
    expect(out).toEqual({
      state: 'pending',
      attempts: 3,
      nextAttemptAt: NOW,
      lastError: 'no signal',
    });
  });

  it('backs off a busy server', () => {
    const out = outcomeAfterFailure(
      row(),
      new ApiError(503, 'unavailable'),
      'unavailable',
      NOW,
      () => 0.5,
      true,
    );
    expect(out.state).toBe('pending');
    expect(out.attempts).toBe(1);
    expect(out.nextAttemptAt).toBe(NOW + RETRY_SCHEDULE_MS[0]!);
  });

  it('parks a refusal at once — the server will say the same next time', () => {
    for (const status of [400, 403, 409, 422]) {
      const out = outcomeAfterFailure(
        row(),
        new ApiError(status, 'no'),
        'no',
        NOW,
        () => 0.5,
        true,
      );
      expect(out.state).toBe('failed');
    }
  });

  it('parks an expired session rather than hammering it', () => {
    const out = outcomeAfterFailure(
      row(),
      new ApiError(401, 'expired'),
      'expired',
      NOW,
      () => 0.5,
      true,
    );
    expect(out.state).toBe('failed');
  });

  it('keeps retrying an idempotent action forever', () => {
    const out = outcomeAfterFailure(
      row({ kind: 'arrived', attempts: 99 }),
      new ApiError(500, 'boom'),
      'boom',
      NOW,
      () => 0.5,
      true,
    );
    expect(out.state).toBe('pending');
  });

  it('gives up on a non-idempotent action rather than risk doubling it', () => {
    const out = outcomeAfterFailure(
      row({ kind: 'note', attempts: MAX_NON_IDEMPOTENT_ATTEMPTS - 1 }),
      new ApiError(500, 'boom'),
      'boom',
      NOW,
      () => 0.5,
      false,
    );
    expect(out.state).toBe('failed');
    expect(out.attempts).toBe(MAX_NON_IDEMPOTENT_ATTEMPTS);
  });
});

describe('shouldRepresign', () => {
  it('asks for a new ticket when S3 refuses the signature', () => {
    expect(shouldRepresign(403)).toBe(true);
    expect(shouldRepresign(400)).toBe(true);
  });

  it('does not re-presign a server that is merely unwell', () => {
    expect(shouldRepresign(500)).toBe(false);
    expect(shouldRepresign(503)).toBe(false);
  });
});

describe('retryPatch', () => {
  it('puts a parked row back at the front with a clean slate', () => {
    expect(retryPatch(NOW)).toEqual({
      state: 'pending',
      attempts: 0,
      nextAttemptAt: NOW,
      lastError: null,
    });
  });
});

describe('canDiscardSilently', () => {
  it('lets an un-presigned photo be dropped without a trace', () => {
    expect(canDiscardSilently({ attachmentId: null })).toBe(true);
  });

  it('keeps a presigned one — the job already shows the attachment', () => {
    // Presign writes metadata and a timeline entry before a byte is sent.
    expect(canDiscardSilently({ attachmentId: 'att-1' })).toBe(false);
  });
});

describe('isSweepable', () => {
  it('keeps a just-sent row around long enough to be seen', () => {
    expect(isSweepable({ state: 'done', nextAttemptAt: NOW }, NOW + 1_000)).toBe(false);
  });

  it('sweeps it once it is old news', () => {
    expect(isSweepable({ state: 'done', nextAttemptAt: NOW }, NOW + 120_000)).toBe(true);
  });

  it('never sweeps something still waiting or parked', () => {
    expect(isSweepable({ state: 'pending', nextAttemptAt: 0 }, NOW)).toBe(false);
    expect(isSweepable({ state: 'failed', nextAttemptAt: 0 }, NOW)).toBe(false);
  });
});
