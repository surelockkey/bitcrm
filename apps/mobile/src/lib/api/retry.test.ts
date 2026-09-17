import { ApiError } from './errors';
import {
  backoffDelayMs,
  classifyError,
  hasAttemptsLeft,
  MAX_BACKOFF_MS,
  MAX_NON_IDEMPOTENT_ATTEMPTS,
  RETRY_SCHEDULE_MS,
  shouldRetryQuery,
} from './retry';

describe('classifyError', () => {
  it('calls a failed fetch offline, not a server error', () => {
    expect(classifyError(new ApiError(0, 'no signal'))).toBe('offline');
  });

  it('separates an expired token from a refused one', () => {
    expect(classifyError(new ApiError(401, 'expired'))).toBe('auth');
    expect(classifyError(new ApiError(403, 'not on the roster'))).toBe('permanent');
  });

  it('treats the server saying no as permanent', () => {
    for (const status of [400, 404, 409, 422]) {
      expect(classifyError(new ApiError(status, 'no'))).toBe('permanent');
    }
  });

  it('treats the server being unwell as transient', () => {
    for (const status of [408, 429, 500, 502, 503]) {
      expect(classifyError(new ApiError(status, 'later'))).toBe('transient');
    }
  });

  it('does not retry our own bugs', () => {
    expect(classifyError(new TypeError('x.map is not a function'))).toBe('permanent');
    expect(classifyError('something odd')).toBe('permanent');
  });
});

describe('shouldRetryQuery', () => {
  it('retries a transient failure up to the budget, then stops', () => {
    const boom = new ApiError(503, 'service unavailable');
    expect(shouldRetryQuery(0, boom)).toBe(true);
    expect(shouldRetryQuery(2, boom)).toBe(true);
    expect(shouldRetryQuery(3, boom)).toBe(false);
  });

  it('never retries a refusal, an expired token or being offline', () => {
    expect(shouldRetryQuery(0, new ApiError(403, 'nope'))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError(401, 'expired'))).toBe(false);
    // Offline is the online-manager's job to resume, not the retry loop's.
    expect(shouldRetryQuery(0, new ApiError(0, 'no signal'))).toBe(false);
  });
});

describe('backoffDelayMs', () => {
  it('walks the documented schedule when jitter is neutral', () => {
    const neutral = 0.5; // 0.5 maps to zero jitter
    const walked = RETRY_SCHEDULE_MS.map((_, i) => backoffDelayMs(i + 1, neutral));
    expect(walked).toEqual([...RETRY_SCHEDULE_MS]);
  });

  it('treats attempt 0 or a fractional attempt as the first wait', () => {
    expect(backoffDelayMs(0, 0.5)).toBe(RETRY_SCHEDULE_MS[0]);
    expect(backoffDelayMs(1.7, 0.5)).toBe(RETRY_SCHEDULE_MS[0]);
  });

  it('keeps doubling past the schedule but never past the ceiling', () => {
    const past = backoffDelayMs(RETRY_SCHEDULE_MS.length + 1, 0.5);
    expect(past).toBe(RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1]! * 2);
    expect(backoffDelayMs(50, 0.5)).toBe(MAX_BACKOFF_MS);
    expect(backoffDelayMs(50, 1)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
  });

  it('spreads retries by at most a fifth either way', () => {
    const base = RETRY_SCHEDULE_MS[2]!;
    expect(backoffDelayMs(3, 0)).toBe(base * 0.8);
    expect(backoffDelayMs(3, 1)).toBe(base * 1.2);
  });

  it('never asks anyone to wait a negative amount of time', () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(backoffDelayMs(attempt, 0)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('hasAttemptsLeft', () => {
  it('lets an idempotent action keep trying forever', () => {
    expect(hasAttemptsLeft(0, true)).toBe(true);
    expect(hasAttemptsLeft(999, true)).toBe(true);
  });

  it('parks a non-idempotent action rather than risk doubling it up', () => {
    expect(hasAttemptsLeft(MAX_NON_IDEMPOTENT_ATTEMPTS - 1, false)).toBe(true);
    expect(hasAttemptsLeft(MAX_NON_IDEMPOTENT_ATTEMPTS, false)).toBe(false);
  });
});
