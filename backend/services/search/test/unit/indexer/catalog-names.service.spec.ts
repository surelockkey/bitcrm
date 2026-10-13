import { CatalogNamesService } from 'src/indexer/catalog-names.service';

/** A fetch whose responses the test releases by hand. */
function deferredFetch() {
  const pending: Array<{ url: string; resolve: (r: unknown) => void; reject: (e: Error) => void }> = [];
  const fn = jest.fn(
    (url: string) =>
      new Promise((resolve, reject) => {
        pending.push({ url, resolve, reject });
      }),
  );
  const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });
  return { fn, pending, ok };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('CatalogNamesService — single-flight', () => {
  const realFetch = global.fetch;
  let f: ReturnType<typeof deferredFetch>;

  beforeEach(() => {
    f = deferredFetch();
    global.fetch = f.fn as any;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('concurrent misses for one catalog share a single fetch', async () => {
    const svc = new CatalogNamesService();
    const a = svc.nameOf('job-types', 'jt1');
    const b = svc.nameOf('job-types', 'jt2');
    const c = svc.nameOf('job-types', 'jt1');
    await flush();
    expect(f.fn).toHaveBeenCalledTimes(1);

    f.pending[0].resolve(f.ok([{ id: 'jt1', name: 'Lockout' }, { id: 'jt2', name: 'Rekey' }]));
    await expect(Promise.all([a, b, c])).resolves.toEqual(['Lockout', 'Rekey', 'Lockout']);

    // Cached afterwards: no further fetch.
    await expect(svc.nameOf('job-types', 'jt2')).resolves.toBe('Rekey');
    expect(f.fn).toHaveBeenCalledTimes(1);
  });

  it('different catalogs fetch independently', async () => {
    const svc = new CatalogNamesService();
    const a = svc.nameOf('job-types', 'x');
    const b = svc.nameOf('job-tags', 'y');
    await flush();
    expect(f.fn).toHaveBeenCalledTimes(2);
    f.pending[0].resolve(f.ok([{ id: 'x', name: 'X' }]));
    f.pending[1].resolve(f.ok([{ id: 'y', name: 'Y' }]));
    await expect(Promise.all([a, b])).resolves.toEqual(['X', 'Y']);
  });

  it('a failed fetch is shared by its waiters, not cached, and does not poison the next call', async () => {
    const svc = new CatalogNamesService();
    const a = svc.nameOf('job-types', 'jt1');
    const b = svc.nameOf('job-types', 'jt1');
    await flush();
    expect(f.fn).toHaveBeenCalledTimes(1);
    f.pending[0].reject(new Error('ECONNREFUSED'));
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);

    const c = svc.nameOf('job-types', 'jt1');
    await flush();
    expect(f.fn).toHaveBeenCalledTimes(2);
    f.pending[1].resolve(f.ok([{ id: 'jt1', name: 'Lockout' }]));
    await expect(c).resolves.toBe('Lockout');
  });

  it('a non-2xx answer is not cached either', async () => {
    const svc = new CatalogNamesService();
    const a = svc.nameOf('service-areas', 's1');
    await flush();
    f.pending[0].resolve({ ok: false, status: 503, json: async () => ({}) });
    await expect(a).resolves.toBeUndefined();

    const b = svc.nameOf('service-areas', 's1');
    await flush();
    expect(f.fn).toHaveBeenCalledTimes(2);
    f.pending[1].resolve(f.ok([{ id: 's1', name: 'North' }]));
    await expect(b).resolves.toBe('North');
  });

  it('invalidate during an in-flight fetch makes the next lookup refetch (the old answer may predate the edit)', async () => {
    const svc = new CatalogNamesService();
    const a = svc.nameOf('job-tags', 't1');
    await flush();
    svc.invalidate('job-tags');
    const b = svc.nameOf('job-tags', 't1');
    await flush();
    expect(f.fn).toHaveBeenCalledTimes(2);

    f.pending[0].resolve(f.ok([{ id: 't1', name: 'Old' }]));
    f.pending[1].resolve(f.ok([{ id: 't1', name: 'New' }]));
    await expect(a).resolves.toBe('Old');
    await expect(b).resolves.toBe('New');

    // The stale in-flight answer did not overwrite the fresh one.
    await expect(svc.nameOf('job-tags', 't1')).resolves.toBe('New');
    expect(f.fn).toHaveBeenCalledTimes(2);
  });

  it('custom-field defs are single-flight too, and a failure is not cached', async () => {
    const svc = new CatalogNamesService();
    const a = svc.customFieldDefs();
    const b = svc.customFieldDefs();
    await flush();
    expect(f.fn).toHaveBeenCalledTimes(1);
    f.pending[0].reject(new Error('down'));
    await expect(Promise.all([a, b])).resolves.toEqual([[], []]);

    const c = svc.customFieldDefs();
    const d = svc.customFieldDefs();
    await flush();
    expect(f.fn).toHaveBeenCalledTimes(2);
    f.pending[1].resolve(f.ok([{ id: 'cf1', searchable: true }]));
    await expect(Promise.all([c, d])).resolves.toEqual([
      [{ id: 'cf1', searchable: true }],
      [{ id: 'cf1', searchable: true }],
    ]);
  });
});
