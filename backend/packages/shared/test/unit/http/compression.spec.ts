import { COMPRESSION_THRESHOLD, shouldCompress } from '../../../src/http/compression';

/**
 * Responses left the services uncompressed. A job's catalogs are 190 KB of
 * JSON that gzips to a fraction of that, and a dispatcher opening a job waited
 * over a second for the bytes alone — on every page, not just that one.
 *
 * Gzipping itself belongs to the `compression` library; what is ours is when
 * to let it — a stream must stay unbuffered, and a short answer is not worth
 * the header.
 */
const res = (headers: Record<string, string> = {}) =>
  ({
    getHeader: (name: string) => headers[name.toLowerCase()],
  }) as never;

const req = {} as never;

describe('shouldCompress', () => {
  it('lets an ordinary JSON response through to gzip', () => {
    expect(shouldCompress(req, res({ 'content-type': 'application/json' }))).toBe(true);
  });

  it('leaves a stream alone, so its events reach the browser as they happen', () => {
    // The softphone and the inbox both hold an SSE stream open; buffering it to
    // compress it would mean events arriving late or in clumps.
    expect(shouldCompress(req, res({ 'content-type': 'text/event-stream' }))).toBe(false);
  });

  it('honours an explicit opt-out', () => {
    expect(
      shouldCompress(req, res({ 'content-type': 'application/json', 'x-no-compression': '1' })),
    ).toBe(false);
  });

  it('does not re-compress what is already compressed', () => {
    expect(shouldCompress(req, res({ 'content-type': 'image/jpeg' }))).toBe(false);
  });

  it('starts paying off well below the size of a catalog', () => {
    // 190 KB of job types is the case this exists for; a one-line answer is not.
    expect(COMPRESSION_THRESHOLD).toBeGreaterThan(0);
    expect(COMPRESSION_THRESHOLD).toBeLessThan(4096);
  });
});
