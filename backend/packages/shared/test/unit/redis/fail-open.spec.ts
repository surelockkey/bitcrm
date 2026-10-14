import { failOpen } from 'src/redis/fail-open';

/**
 * A cache is an optimisation: when Redis is gone (a task shutting down, a
 * failover) the read must fall through to the source of truth, never 500.
 */
describe('failOpen', () => {
  it('returns what the operation returns', async () => {
    await expect(failOpen(async () => 'hit', null)).resolves.toBe('hit');
  });

  it('returns the fallback and reports the error when Redis throws', async () => {
    const onError = jest.fn();
    await expect(
      failOpen(async () => {
        throw new Error('Connection is closed.');
      }, null, onError),
    ).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Connection is closed.' }));
  });

  it('also catches a synchronous throw from the client', async () => {
    await expect(
      failOpen(() => {
        throw new Error('boom');
      }, 'fallback'),
    ).resolves.toBe('fallback');
  });
});
