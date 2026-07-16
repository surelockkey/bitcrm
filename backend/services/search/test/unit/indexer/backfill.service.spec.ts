import { BackfillService } from 'src/indexer/backfill/backfill.service';

describe('BackfillService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  function fakeIndexer() {
    return { bulkIndex: jest.fn().mockImplementation((docs: any[]) => Promise.resolve(docs.length)) };
  }

  it('reads the wrapped { data: { items, nextCursor } } shape and bulk-indexes', async () => {
    // one contact page for every source, no cursor → single page each
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          items: [
            {
              id: 'x1',
              title: 'Acme',
              name: 'Acme',
              firstName: 'A',
              lastName: 'B',
              sku: 'S1',
              phones: [],
              emails: [],
              items: [],
              status: 'active',
              createdBy: 'u1',
              performedBy: 'u1',
              technicianName: 'T',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-02T00:00:00Z',
            },
          ],
          nextCursor: undefined,
        },
      }),
    }) as any;

    const indexer = fakeIndexer();
    const totals = await new BackfillService(indexer as any).run();

    // 8 sources, each contributed 1 doc
    expect(global.fetch).toHaveBeenCalledTimes(8);
    expect(indexer.bulkIndex).toHaveBeenCalled();
    const sum = Object.values(totals).reduce((a, b) => a + (b as number), 0);
    expect(sum).toBe(8);
  });

  it('paginates while a nextCursor is returned', async () => {
    let call = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      // first call for the first source returns a cursor, then stop
      const withCursor = call === 1;
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            items: [{ id: `d${call}`, updatedAt: '2026-01-02T00:00:00Z', status: 'active', title: 't', name: 'n', createdBy: 'u', phones: [], emails: [] }],
            nextCursor: withCursor ? 'CURSOR' : undefined,
          },
        }),
      };
    }) as any;

    const indexer = fakeIndexer();
    await new BackfillService(indexer as any).run();
    // 8 sources + 1 extra page from the paginated first source
    expect(global.fetch).toHaveBeenCalledTimes(9);
  });

  it('records -1 for a source whose endpoint errors, without aborting the rest', async () => {
    let call = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ success: true, data: { items: [], nextCursor: undefined } }) };
    }) as any;

    const totals = await new BackfillService(fakeIndexer() as any).run();
    const failed = Object.values(totals).filter((v) => v === -1);
    expect(failed).toHaveLength(1);
    // the other 7 still ran
    expect(global.fetch).toHaveBeenCalledTimes(8);
  });
});
