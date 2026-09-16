import { BackfillService, SOURCES, mapLimit } from 'src/indexer/backfill/backfill.service';
import { parseTypes } from 'src/scripts/run-backfill';

function stubCatalogNames() {
  return {
    nameOf: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn(),
    customFieldDefs: jest.fn().mockResolvedValue([]),
  };
}

/** One source per SearchType with an internal list route (deal … conversation). */
const SOURCE_COUNT = SOURCES.length;

describe('BackfillService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  function fakeIndexer() {
    return {
      bulkIndex: jest.fn().mockImplementation((docs: any[]) => Promise.resolve(docs.length)),
      resolveDealClient: jest.fn().mockResolvedValue(undefined),
      resolveConversationContext: jest.fn().mockResolvedValue({}),
    };
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
    const totals = await new BackfillService(indexer as any, stubCatalogNames() as any).run();

    // every source contributed 1 doc
    expect(global.fetch).toHaveBeenCalledTimes(SOURCE_COUNT);
    expect(indexer.bulkIndex).toHaveBeenCalled();
    const sum = Object.values(totals).reduce((a, b) => a + (b as number), 0);
    expect(sum).toBe(SOURCE_COUNT);
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
    await new BackfillService(indexer as any, stubCatalogNames() as any).run();
    // every source + 1 extra page from the paginated first source
    expect(global.fetch).toHaveBeenCalledTimes(SOURCE_COUNT + 1);
  });

  it('rebuilds only the requested types when given a filter', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { items: [], nextCursor: undefined } }),
    }) as any;

    const totals = await new BackfillService(fakeIndexer() as any, stubCatalogNames() as any).run(['deal']);

    expect(Object.keys(totals)).toEqual(['deal']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('/api/deals/');
  });

  it('enriches deal docs with their client via the indexer', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          items: [{
            id: 'd1', dealNumber: 'K4T9ZW', contactId: 'c1', address: {},
            assignedTechIds: [], assignedDispatcherId: 'u1', tagIds: [],
            status: 'active', createdBy: 'u1',
            createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
          }],
          nextCursor: undefined,
        },
      }),
    }) as any;

    const indexer = fakeIndexer();
    indexer.resolveDealClient.mockResolvedValue({ name: 'John Smith', phones: ['(728) 347-8370'] });

    await new BackfillService(indexer as any, stubCatalogNames() as any).run(['deal']);

    expect(indexer.resolveDealClient).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      expect.any(Map),
    );
    const doc = indexer.bulkIndex.mock.calls[0][0][0];
    expect(doc.keywords).toEqual(expect.arrayContaining(['John Smith', '7283478370']));
  });

  it('records -1 for a source whose endpoint errors, without aborting the rest', async () => {
    let call = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, json: async () => ({ success: true, data: { items: [], nextCursor: undefined } }) };
    }) as any;

    const totals = await new BackfillService(fakeIndexer() as any, stubCatalogNames() as any).run();
    const failed = Object.values(totals).filter((v) => v === -1);
    expect(failed).toHaveLength(1);
    // the other sources still ran
    expect(global.fetch).toHaveBeenCalledTimes(SOURCE_COUNT);
  });

  describe('conversation source (messaging internal export)', () => {
    const thread = (id: string) => ({
      id,
      kind: 'client',
      partyKind: 'contact',
      partyId: 'c1',
      addresses: { phones: ['+17283478370'], emails: [] },
      state: 'open',
      unread: false,
      unreadCount: 0,
      flagged: false,
      lastMessagePreview: 'ok',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-15T10:05:00.000Z',
    });

    /** Pages keyed by cursor ('' = first page); records every URL asked for. */
    function pagedFetch(pages: Record<string, { items: any[]; nextCursor?: string }>) {
      const urls: string[] = [];
      global.fetch = jest.fn().mockImplementation(async (url: string) => {
        urls.push(url);
        const cursor = new URL(url).searchParams.get('cursor') ?? '';
        const page = pages[cursor];
        if (!page) return { ok: false, status: 400, json: async () => ({}) };
        return { ok: true, json: async () => ({ success: true, data: page }) };
      }) as any;
      return urls;
    }

    it('reads messaging\'s internal export and enriches each thread through the indexer with a shared cache', async () => {
      const urls = pagedFetch({ '': { items: [thread('cv1'), thread('cv2')] } });
      const indexer = fakeIndexer();
      indexer.resolveConversationContext.mockResolvedValue({
        partyName: 'John Smith',
        deals: [{ id: 'd1', dealNumber: 'K4T9ZW', assignedTechIds: ['tech1'] }],
      });

      const totals = await new BackfillService(indexer as any, stubCatalogNames() as any).run(['conversation']);

      expect(totals).toEqual({ conversation: 2 });
      expect(urls).toHaveLength(1);
      expect(urls[0]).toMatch(/\/api\/messaging\/conversations\/internal\/all\?limit=200$/);
      expect(indexer.resolveConversationContext).toHaveBeenCalledTimes(2);
      const [, cache] = indexer.resolveConversationContext.mock.calls[0];
      expect(cache).toBeInstanceOf(Map);
      expect(indexer.resolveConversationContext.mock.calls[1][1]).toBe(cache);

      const docs = indexer.bulkIndex.mock.calls[0][0];
      expect(docs.map((d: any) => d.docId)).toEqual(['conversation#cv1', 'conversation#cv2']);
      expect(docs[0]).toMatchObject({
        type: 'conversation',
        permissionResource: 'messages',
        title: 'John Smith',
        ownerIds: ['tech1'],
        url: '/messages/cv1',
      });
      expect(docs[0].keywords).toEqual(expect.arrayContaining(['K4T9ZW', '7283478370']));
    });

    it('follows nextCursor page by page, passing each cursor back verbatim, and bulk-indexes every page', async () => {
      const urls = pagedFetch({
        '': { items: [thread('cv1')], nextCursor: 'eyJzIjoib3BlbiJ9' },
        eyJzIjoib3BlbiJ9: { items: [thread('cv2'), thread('cv3')], nextCursor: 'eyJzIjoiYXJjaGl2ZWQifQ' },
        eyJzIjoiYXJjaGl2ZWQifQ: { items: [thread('cv4')] },
      });
      const indexer = fakeIndexer();

      const totals = await new BackfillService(indexer as any, stubCatalogNames() as any).run(['conversation']);

      expect(totals).toEqual({ conversation: 4 });
      expect(urls.map((u) => new URL(u).searchParams.get('cursor'))).toEqual([null, 'eyJzIjoib3BlbiJ9', 'eyJzIjoiYXJjaGl2ZWQifQ']);
      expect(urls.every((u) => new URL(u).searchParams.get('limit') === '200')).toBe(true);
      expect(indexer.bulkIndex).toHaveBeenCalledTimes(3);
      expect(indexer.bulkIndex.mock.calls.map((c) => c[0].length)).toEqual([1, 2, 1]);
    });

    it('stops at an empty last page and reports the source as failed on an HTTP error mid-walk', async () => {
      pagedFetch({ '': { items: [thread('cv1')], nextCursor: 'MISSING' } });
      const indexer = fakeIndexer();
      const totals = await new BackfillService(indexer as any, stubCatalogNames() as any).run(['conversation']);
      expect(totals).toEqual({ conversation: -1 });
      // The first page was still written before the failure — the run is upsert-only, so a retry is safe.
      expect(indexer.bulkIndex).toHaveBeenCalledTimes(1);
    });

    it('spaces pages by pageDelayMs — never before the first page', async () => {
      pagedFetch({
        '': { items: [thread('cv1')], nextCursor: 'P2' },
        P2: { items: [thread('cv2')], nextCursor: 'P3' },
        P3: { items: [thread('cv3')] },
      });
      const sleep = jest.fn().mockResolvedValue(undefined);
      await new BackfillService(fakeIndexer() as any, stubCatalogNames() as any, { pageDelayMs: 250, sleep }).run([
        'conversation',
      ]);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(250);

      sleep.mockClear();
      await new BackfillService(fakeIndexer() as any, stubCatalogNames() as any, { pageDelayMs: 0, sleep }).run([
        'conversation',
      ]);
      expect(sleep).not.toHaveBeenCalled();
    });

    it('bounds enrichment to `concurrency` threads in flight per page', async () => {
      pagedFetch({ '': { items: Array.from({ length: 7 }, (_, i) => thread(`cv${i}`)) } });
      const indexer = fakeIndexer();
      let inFlight = 0;
      let peak = 0;
      indexer.resolveConversationContext.mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight -= 1;
        return {};
      });

      await new BackfillService(indexer as any, stubCatalogNames() as any, { concurrency: 3 }).run(['conversation']);

      expect(indexer.resolveConversationContext).toHaveBeenCalledTimes(7);
      expect(peak).toBe(3);
      expect(indexer.bulkIndex.mock.calls[0][0].map((d: any) => d.entityId)).toEqual(
        ['cv0', 'cv1', 'cv2', 'cv3', 'cv4', 'cv5', 'cv6'],
      );
    });
  });
});

describe('mapLimit', () => {
  it('preserves order, bounds concurrency and handles an empty list', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
    expect(await mapLimit([], 4, async (x) => x)).toEqual([]);
  });
});

describe('run-backfill CLI', () => {
  it('parses the requested types, defaults to all, and refuses unknown ones', () => {
    expect(parseTypes([])).toBeUndefined();
    expect(parseTypes(['conversation'])).toEqual(['conversation']);
    expect(parseTypes(['deal', ' contact '])).toEqual(['deal', 'contact']);
    expect(() => parseTypes(['conversations'])).toThrow(/Unknown search type\(s\): conversations/);
  });
});
