import {
  clientLineAt,
  clientLineCount,
  extensionKeys,
} from '../../src/common/client-line';

/**
 * Which of a job's client numbers a masked call rings, shared by both ways in
 * (the in-app bridge and the technician dial-in) so a code minted for "the
 * second number" and the second call button can never disagree.
 */
const CLIENT = {
  phones: ['+14045551234', '+14045555678'],
  extensions: { '+14045555678': '102' },
};

describe('clientLineAt', () => {
  it('rings the client’s first number at index 0', () => {
    expect(clientLineAt({}, CLIENT, 0)).toEqual({ to: '+14045551234' });
  });

  it('rings the job’s own first number at index 0 when it has one ("This job only")', () => {
    expect(clientLineAt({ clientPhone: '+12035550123' }, CLIENT, 0)).toMatchObject({
      to: '+12035550123',
    });
  });

  it('rings the client’s numbers past the first, never the job’s own', () => {
    expect(clientLineAt({ clientPhone: '+12035550123' }, CLIENT, 1)).toEqual({
      to: '+14045555678',
      extension: '102',
    });
  });

  it('carries the extension that belongs to the number', () => {
    expect(clientLineAt({}, CLIENT, 1)?.extension).toBe('102');
  });

  /**
   * The job page shows the first line's extension as the client's first
   * number's, whichever number the job dials there — so that is what is
   * pressed, unless the job's own number has an extension of its own.
   */
  it('keeps the first line’s extension when the job overrides the number', () => {
    const client = { phones: ['+14045551234'], extensions: { '+14045551234': '7' } };
    expect(clientLineAt({ clientPhone: '+12035550123' }, client, 0)).toEqual({
      to: '+12035550123',
      extension: '7',
    });
  });

  it('prefers the extension keyed by the number actually dialled', () => {
    const client = {
      phones: ['+14045551234'],
      extensions: { '+14045551234': '7', '+12035550123': '55' },
    };
    expect(clientLineAt({ clientPhone: '+12035550123' }, client, 0)?.extension).toBe('55');
  });

  /** A number removed after its code was printed: nothing to ring. */
  it('answers null for a position that no longer exists', () => {
    expect(clientLineAt({}, CLIENT, 2)).toBeNull();
    expect(clientLineAt({}, { phones: [] }, 0)).toBeNull();
    expect(clientLineAt({}, null, 1)).toBeNull();
  });

  it('answers null for a nonsense index', () => {
    expect(clientLineAt({}, CLIENT, -1)).toBeNull();
    expect(clientLineAt({}, CLIENT, 1.5)).toBeNull();
  });

  it('still rings the job’s own number when the client cannot be read', () => {
    expect(clientLineAt({ clientPhone: '+12035550123' }, null, 0)).toEqual({
      to: '+12035550123',
    });
  });
});

describe('clientLineCount', () => {
  it('counts the client’s numbers', () => {
    expect(clientLineCount({}, CLIENT)).toBe(2);
  });

  it('counts the job’s own number when the client has none', () => {
    expect(clientLineCount({ clientPhone: '+12035550123' }, { phones: [] })).toBe(1);
    expect(clientLineCount({ clientPhone: '+12035550123' }, null)).toBe(1);
  });

  it('is zero when there is nothing to ring', () => {
    expect(clientLineCount({}, null)).toBe(0);
  });
});

/**
 * What Twilio presses once the client answers. A pause first — an
 * auto-attendant needs a beat before it listens — and only keys a phone has.
 */
describe('extensionKeys', () => {
  it('waits, then presses the extension', () => {
    expect(extensionKeys('102')).toBe('ww102');
  });

  it('turns a typed pause (",") into a one-second wait', () => {
    expect(extensionKeys('9,102#')).toBe('ww9W102#');
  });

  it('drops anything that is not a key', () => {
    expect(extensionKeys('ext. 1-02')).toBe('ww102');
  });

  it('is undefined when there is nothing to press', () => {
    expect(extensionKeys(undefined)).toBeUndefined();
    expect(extensionKeys('')).toBeUndefined();
    expect(extensionKeys('ext.')).toBeUndefined();
  });

  it('stays within Twilio’s 32-key limit', () => {
    expect(extensionKeys('1'.repeat(60))!.length).toBeLessThanOrEqual(32);
  });
});
