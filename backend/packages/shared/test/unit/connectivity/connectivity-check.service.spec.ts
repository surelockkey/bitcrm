import { ConnectivityCheckService } from '../../../src/connectivity/connectivity-check.service';
import { Probe } from '../../../src/connectivity/connectivity.types';

const fakeProbe = (
  name: string,
  outcome: { ok: boolean; delay?: number; throws?: Error; message?: string },
): Probe => ({
  name,
  kind: 'http',
  run: async () => {
    if (outcome.delay) {
      await new Promise((r) => setTimeout(r, outcome.delay));
    }
    if (outcome.throws) throw outcome.throws;
    return { ok: outcome.ok, message: outcome.message };
  },
});

describe('ConnectivityCheckService', () => {
  it('runs all probes and returns one result per probe', async () => {
    const probes = [fakeProbe('a', { ok: true }), fakeProbe('b', { ok: true })];
    const svc = new ConnectivityCheckService(probes);

    const results = await svc.runAll();

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name).sort()).toEqual(['a', 'b']);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('runs probes in parallel, not sequentially', async () => {
    const probes = [
      fakeProbe('a', { ok: true, delay: 80 }),
      fakeProbe('b', { ok: true, delay: 80 }),
      fakeProbe('c', { ok: true, delay: 80 }),
    ];
    const svc = new ConnectivityCheckService(probes);

    const start = Date.now();
    await svc.runAll();
    const elapsed = Date.now() - start;

    // sequential would be ~240ms; parallel should be <150ms
    expect(elapsed).toBeLessThan(150);
  });

  it('returns ok=false with error when a probe throws', async () => {
    const probes = [
      fakeProbe('good', { ok: true }),
      fakeProbe('bad', { ok: false, throws: new Error('boom') }),
    ];
    const svc = new ConnectivityCheckService(probes);

    const results = await svc.runAll();
    const bad = results.find((r) => r.name === 'bad')!;

    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('boom');
    expect(results.find((r) => r.name === 'good')!.ok).toBe(true);
  });

  it('times out a slow probe and marks it failed', async () => {
    const probes = [fakeProbe('slow', { ok: true, delay: 500 })];
    const svc = new ConnectivityCheckService(probes, { probeTimeoutMs: 50 });

    const result = (await svc.runAll())[0];

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timeout/i);
    expect(result.durationMs).toBeLessThan(200);
  });

  it('records non-zero duration for each probe', async () => {
    const probes = [fakeProbe('a', { ok: true, delay: 20 })];
    const svc = new ConnectivityCheckService(probes);

    const result = (await svc.runAll())[0];

    expect(result.durationMs).toBeGreaterThanOrEqual(15);
  });

  it('preserves probe message and kind on success', async () => {
    const probes = [fakeProbe('pinger', { ok: true, message: 'PONG' })];
    const svc = new ConnectivityCheckService(probes);

    const result = (await svc.runAll())[0];

    expect(result.name).toBe('pinger');
    expect(result.kind).toBe('http');
    expect(result.message).toBe('PONG');
  });
});
