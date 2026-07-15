import { buildSearchBody } from 'src/search/search-query.builder';

const authz = { match_all: {} };

function boolOf(body: any) {
  return body.query.function_score.query.bool;
}

describe('buildSearchBody', () => {
  describe('common query shape', () => {
    it('searches the boosted fields with the query text', () => {
      const body = buildSearchBody({ q: 'acme', authzClause: authz, mode: 'full' });
      const mm = boolOf(body).must[0].multi_match;
      expect(mm.query).toBe('acme');
      expect(mm.fields).toEqual(
        expect.arrayContaining(['title^5', 'keywords^3', 'subtitle^2', 'body^1']),
      );
    });

    it('places the authorization clause in the filter', () => {
      const body = buildSearchBody({ q: 'x', authzClause: authz, mode: 'full' });
      expect(boolOf(body).filter).toEqual(expect.arrayContaining([authz]));
    });

    it('excludes deleted and archived docs by default', () => {
      const body = buildSearchBody({ q: 'x', authzClause: authz, mode: 'full' });
      expect(boolOf(body).must_not).toEqual([
        { terms: { status: ['deleted', 'archived'] } },
      ]);
    });

    it('filters by requested types when provided', () => {
      const body = buildSearchBody({
        q: 'x',
        authzClause: authz,
        mode: 'full',
        types: ['deal', 'contact'],
      });
      expect(boolOf(body).filter).toEqual(
        expect.arrayContaining([{ terms: { type: ['deal', 'contact'] } }]),
      );
    });

    it('boosts recent documents via a recency decay function', () => {
      const body = buildSearchBody({ q: 'x', authzClause: authz, mode: 'full' });
      const fns = body.query.function_score.functions;
      expect(fns[0].gauss.updatedAt).toBeDefined();
    });
  });

  describe('typeahead mode', () => {
    it('returns no flat hits and groups top-N per type via aggregation', () => {
      const body = buildSearchBody({
        q: 'ac',
        authzClause: authz,
        mode: 'typeahead',
        perTypeLimit: 5,
      });
      expect(body.size).toBe(0);
      expect(body.aggs.types.terms.field).toBe('type');
      expect(body.aggs.types.aggs.top.top_hits.size).toBe(5);
    });

    it('defaults perTypeLimit when not given', () => {
      const body = buildSearchBody({ q: 'ac', authzClause: authz, mode: 'typeahead' });
      expect(body.aggs.types.aggs.top.top_hits.size).toBeGreaterThan(0);
    });
  });

  describe('full mode', () => {
    it('paginates with from/size and exposes type facets', () => {
      const body = buildSearchBody({
        q: 'acme',
        authzClause: authz,
        mode: 'full',
        page: 3,
        size: 20,
      });
      expect(body.size).toBe(20);
      expect(body.from).toBe(40); // (3 - 1) * 20
      expect(body.aggs.types.terms.field).toBe('type');
    });

    it('clamps page to a minimum of 1', () => {
      const body = buildSearchBody({
        q: 'acme',
        authzClause: authz,
        mode: 'full',
        page: 0,
        size: 20,
      });
      expect(body.from).toBe(0);
    });
  });
});
