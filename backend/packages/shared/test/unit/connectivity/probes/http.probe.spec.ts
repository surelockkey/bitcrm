import { HttpProbe } from '../../../../src/connectivity/probes/http.probe';

describe('HttpProbe', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns ok on 2xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const probe = new HttpProbe('crm', 'http://localhost:4002/api/crm/health');

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.message).toContain('200');
  });

  it('returns ok=false on non-2xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
    const probe = new HttpProbe('crm', 'http://localhost:4002/api/crm/health');

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.error).toContain('503');
  });

  it('propagates fetch failure for the runner to catch', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const probe = new HttpProbe('crm', 'http://localhost:4002');

    await expect(probe.run()).rejects.toThrow('ECONNREFUSED');
  });

  it('uses provided name', () => {
    const probe = new HttpProbe('user', 'http://localhost:4001');
    expect(probe.name).toBe('user');
    expect(probe.kind).toBe('http');
  });
});
