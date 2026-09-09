import { OpenSearchProbe } from '../../../../src/connectivity/probes/opensearch.probe';

describe('OpenSearchProbe', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  const clusterHealth = (status: string) => ({
    ok: true,
    status: 200,
    json: async () => ({ status, cluster_name: 'bitcrm' }),
  });

  it('is ok on a green cluster', async () => {
    global.fetch = jest.fn().mockResolvedValue(clusterHealth('green')) as any;
    const probe = new OpenSearchProbe('http://localhost:9200');

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.message).toContain('green');
  });

  // Single-node dev clusters sit on yellow permanently (replicas unassigned
  // with nowhere to place them). Treating that as down would alert forever.
  it('is ok on a yellow cluster', async () => {
    global.fetch = jest.fn().mockResolvedValue(clusterHealth('yellow')) as any;
    const probe = new OpenSearchProbe('http://localhost:9200');

    expect((await probe.run()).ok).toBe(true);
  });

  it('is not ok on a red cluster', async () => {
    global.fetch = jest.fn().mockResolvedValue(clusterHealth('red')) as any;
    const probe = new OpenSearchProbe('http://localhost:9200');

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.error).toContain('red');
  });

  it('is not ok on a non-2xx health response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }) as any;
    const probe = new OpenSearchProbe('http://localhost:9200');

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.error).toContain('503');
  });

  it('reports each required index as a resource', async () => {
    global.fetch = jest.fn(async (url: any) => {
      if (String(url).includes('_cluster/health')) return clusterHealth('green');
      return String(url).includes('missing')
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({}) };
    }) as any;
    const probe = new OpenSearchProbe('http://localhost:9200', [
      'bitcrm-search',
      'missing-index',
    ]);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.resources).toEqual([
      { resource: 'bitcrm-search', present: true },
      { resource: 'missing-index', present: false, details: 'HTTP 404' },
    ]);
  });

  it('does not probe indices when the cluster itself is unreachable', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 502, json: async () => ({}) });
    global.fetch = fetchMock as any;
    const probe = new OpenSearchProbe('http://localhost:9200', ['bitcrm-search']);

    await probe.run();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propagates a connection failure for the runner to catch', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
    const probe = new OpenSearchProbe('http://localhost:9200');

    await expect(probe.run()).rejects.toThrow('ECONNREFUSED');
  });

  it('exposes name and kind', () => {
    const probe = new OpenSearchProbe('http://localhost:9200');
    expect(probe.name).toBe('opensearch');
    expect(probe.kind).toBe('opensearch');
  });
});
