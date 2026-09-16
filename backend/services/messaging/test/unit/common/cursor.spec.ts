import { InvalidCursorError, decodeCursor, encodeCursor } from '../../../src/common/cursor';

describe('pagination cursor', () => {
  it('round-trips an object through base64url', () => {
    const cursor = encodeCursor({ y: '2025', k: { PK: 'CONV#c1', SK: 'METADATA' } });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({ y: '2025', k: { PK: 'CONV#c1', SK: 'METADATA' } });
  });

  it('treats an absent cursor as the first page', () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor('')).toBeUndefined();
  });

  it('rejects garbage rather than querying with it', () => {
    expect(() => decodeCursor('not base64 json')).toThrow(InvalidCursorError);
    expect(() => decodeCursor(Buffer.from('[1,2]').toString('base64url'))).toThrow(InvalidCursorError);
  });
});
