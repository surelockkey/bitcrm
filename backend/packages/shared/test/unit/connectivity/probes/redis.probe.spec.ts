import { RedisProbe } from '../../../../src/connectivity/probes/redis.probe';

describe('RedisProbe', () => {
  it('returns ok on PONG', async () => {
    const client = { ping: jest.fn().mockResolvedValue('PONG') };
    const probe = new RedisProbe(client);

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.message).toBe('PONG');
  });

  it('returns ok=false on unexpected ping response', async () => {
    const client = { ping: jest.fn().mockResolvedValue('WAT') };
    const probe = new RedisProbe(client);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.error).toContain('WAT');
  });

  it('propagates client errors via the runner timeout (raises)', async () => {
    const client = { ping: jest.fn().mockRejectedValue(new Error('econnrefused')) };
    const probe = new RedisProbe(client);

    await expect(probe.run()).rejects.toThrow('econnrefused');
  });
});
