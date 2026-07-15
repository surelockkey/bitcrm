import { parseSearchResponse } from 'src/search/search-response.parser';

describe('parseSearchResponse', () => {
  describe('typeahead', () => {
    const osResponse = {
      took: 12,
      hits: { total: { value: 0 }, hits: [] },
      aggregations: {
        types: {
          buckets: [
            {
              key: 'deal',
              doc_count: 7,
              top: {
                hits: {
                  hits: [
                    {
                      _score: 3.2,
                      _source: {
                        entityId: 'd1',
                        type: 'deal',
                        title: 'Deal #1042',
                        subtitle: 'Install · assigned',
                        badges: ['assigned'],
                        url: '/deals/d1',
                      },
                    },
                  ],
                },
              },
            },
            {
              key: 'contact',
              doc_count: 2,
              top: {
                hits: {
                  hits: [
                    {
                      _score: 1.1,
                      _source: {
                        entityId: 'c1',
                        type: 'contact',
                        title: 'John Smith',
                        badges: [],
                        url: '/contacts/c1',
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };

    it('produces one group per type with per-type totals and hits', () => {
      const res = parseSearchResponse(osResponse, { query: 'ac', mode: 'typeahead' });
      expect(res.mode).toBe('typeahead');
      expect(res.query).toBe('ac');
      expect(res.took).toBe(12);
      expect(res.groups).toHaveLength(2);

      const deals = res.groups.find((g) => g.type === 'deal')!;
      expect(deals.total).toBe(7);
      expect(deals.items[0]).toEqual({
        entityId: 'd1',
        type: 'deal',
        title: 'Deal #1042',
        subtitle: 'Install · assigned',
        badges: ['assigned'],
        url: '/deals/d1',
        score: 3.2,
      });
    });

    it('has no flat hits list in typeahead mode', () => {
      const res = parseSearchResponse(osResponse, { query: 'ac', mode: 'typeahead' });
      expect(res.hits).toBeUndefined();
    });
  });

  describe('full', () => {
    const osResponse = {
      took: 8,
      hits: {
        total: { value: 42 },
        hits: [
          {
            _score: 2.0,
            _source: { entityId: 'd1', type: 'deal', title: 'Deal #1042', badges: [], url: '/deals/d1' },
          },
          {
            _score: 1.5,
            _source: { entityId: 'c1', type: 'contact', title: 'John', badges: [], url: '/contacts/c1' },
          },
        ],
      },
      aggregations: {
        types: { buckets: [ { key: 'deal', doc_count: 30 }, { key: 'contact', doc_count: 12 } ] },
      },
    };

    it('produces a flat relevance-ordered hits list, facets, and pagination', () => {
      const res = parseSearchResponse(osResponse, {
        query: 'acme',
        mode: 'full',
        page: 2,
        size: 20,
      });
      expect(res.hits).toHaveLength(2);
      expect(res.hits![0].entityId).toBe('d1');
      expect(res.hits![0].score).toBe(2.0);
      expect(res.total).toBe(42);
      expect(res.page).toBe(2);
      expect(res.size).toBe(20);
      expect(res.facets).toEqual({ deal: 30, contact: 12 });
      expect(res.groups).toEqual([]);
    });
  });

  it('tolerates a response with no aggregations', () => {
    const res = parseSearchResponse(
      { took: 1, hits: { total: { value: 0 }, hits: [] } },
      { query: 'x', mode: 'typeahead' },
    );
    expect(res.groups).toEqual([]);
  });
});
