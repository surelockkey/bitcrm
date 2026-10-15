import { LEFT_OUT_BY_DEFAULT, buildSearchBody } from 'src/search/search-query.builder';

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
      expect(boolOf(body).must_not).toEqual(
        expect.arrayContaining([{ terms: { status: ['deleted', 'archived'] } }]),
      );
    });

    // Як у Workiz: глобальний пошук не знаходить товари.
    it('leaves products and stock out of a search that names no types', () => {
      for (const mode of ['full', 'typeahead'] as const) {
        const body = buildSearchBody({ q: 'deadbolt', authzClause: authz, mode });
        expect(boolOf(body).must_not).toEqual([
          { terms: { status: ['deleted', 'archived'] } },
          { terms: { type: ['product', 'stock'] } },
        ]);
      }
      expect(LEFT_OUT_BY_DEFAULT).toEqual(['product', 'stock']);
    });

    it('still finds products for a caller that asks for them by name', () => {
      const body = buildSearchBody({ q: 'deadbolt', authzClause: authz, mode: 'full', types: ['product'] });
      expect(boolOf(body).filter).toEqual(expect.arrayContaining([{ terms: { type: ['product'] } }]));
      expect(boolOf(body).must_not).toEqual([{ terms: { status: ['deleted', 'archived'] } }]);
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

    // A client imported from Workiz two years ago is still the client: «cbre»
    // has to find CBRE, not a contact touched last week whose name is one typo away.
    it('lets recency only nudge the order — an old document keeps two thirds of a new one’s weight', () => {
      const fs = buildSearchBody({ q: 'cbre', authzClause: authz, mode: 'full' }).query.function_score;
      expect(fs.functions).toEqual([
        { gauss: { updatedAt: expect.any(Object) }, weight: 0.5 },
        { weight: 1 },
      ]);
      expect(fs.score_mode).toBe('sum');
      expect(fs.boost_mode).toBe('multiply');
    });

    it('ranks an exact match above a fuzzy one', () => {
      for (const mode of ['full', 'typeahead'] as const) {
        const should = boolOf(buildSearchBody({ q: 'cbre', authzClause: authz, mode })).should;
        expect(should).toEqual([
          { multi_match: { query: 'cbre', fields: expect.arrayContaining(['title^5']), operator: 'and', boost: 3 } },
        ]);
      }
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

  describe('phone-like queries', () => {
    /** Every clause of the match, whatever its nesting, as a flat list. */
    function phoneShould(q: string, mode: 'full' | 'typeahead' = 'typeahead') {
      return boolOf(buildSearchBody({ q, authzClause: authz, mode })).must[0].bool.should as any[];
    }
    function containsFuzziness(node: unknown): boolean {
      return JSON.stringify(node).includes('fuzziness');
    }

    // The bug: after a client got a second number, searching it found unrelated
    // records — the fuzzy clause let a 10-digit number match any number two
    // digits off (and every edge-ngram fragment), pushing the client out of the top 5.
    it('never fuzzes a phone query — one wrong digit is a different number', () => {
      for (const q of ['7283478370', '(728) 347-8370', '+1 728 347 8370', '8370', '(292) 8']) {
        for (const mode of ['full', 'typeahead'] as const) {
          const body = buildSearchBody({ q, authzClause: authz, mode });
          expect(containsFuzziness(boolOf(body))).toBe(false);
        }
      }
    });

    it('matches a full number exactly against the indexed phone variants, ranked first', () => {
      const should = phoneShould('7283478370');
      expect(should).toContainEqual({
        constant_score: { filter: { terms: { phoneDigits: ['7283478370'] } }, boost: 100 },
      });
    });

    it('collapses a formatted number to its digits for the exact phone match', () => {
      const should = phoneShould('(728) 347-8370');
      expect(should).toContainEqual({
        constant_score: { filter: { terms: { phoneDigits: ['7283478370'] } }, boost: 100 },
      });
      // The formatted text itself is not searched any more — only its digits.
      expect(JSON.stringify(should)).not.toContain('(728) 347-8370');
    });

    it('reads a leading +1 / 1 country code as the same number', () => {
      for (const q of ['+1 (728) 347-8370', '17283478370']) {
        expect(phoneShould(q)).toContainEqual({
          constant_score: {
            filter: { terms: { phoneDigits: ['17283478370', '7283478370'] } },
            boost: 100,
          },
        });
      }
    });

    it('lets a number still being typed find the numbers that start or end with it', () => {
      // The indexed variants hold every 4+ digit suffix, so a prefix of a
      // variant is any 4+ digit run inside the number.
      expect(phoneShould('728347837')).toContainEqual({
        constant_score: { filter: { prefix: { phoneDigits: '728347837' } }, boost: 20 },
      });
      expect(phoneShould('(292) 8')).toContainEqual({
        constant_score: { filter: { prefix: { phoneDigits: '2928' } }, boost: 5 },
      });
      expect(phoneShould('839-8283')).toContainEqual({
        constant_score: { filter: { terms: { phoneDigits: ['8398283'] } }, boost: 100 },
      });
    });

    it('does not treat a short fragment as a whole number (no exact-number boost)', () => {
      const should = phoneShould('8370');
      expect(JSON.stringify(should)).not.toContain('"terms"');
      expect(should).toContainEqual({
        constant_score: { filter: { prefix: { phoneDigits: '8370' } }, boost: 5 },
      });
    });

    it('keeps an exact (non-fuzzy) digit match on the text fields — job numbers, zips, PO numbers', () => {
      const should = phoneShould('1042', 'full');
      expect(should).toContainEqual({
        multi_match: { query: '1042', fields: expect.arrayContaining(['title^5', 'keywords^3']), operator: 'and' },
      });
      expect(boolOf(buildSearchBody({ q: '1042', authzClause: authz, mode: 'full' })).must[0].bool.minimum_should_match).toBe(1);
    });

    it('gives the exact bonus to the collapsed digits, not the formatted text', () => {
      const should = boolOf(buildSearchBody({ q: '(728) 347-8370', authzClause: authz, mode: 'full' })).should;
      expect(should).toEqual([
        { multi_match: { query: '7283478370', fields: expect.arrayContaining(['title^5']), operator: 'and', boost: 3 } },
      ]);
    });

    it('keeps the plain fuzzy single-clause shape for text queries', () => {
      const body = buildSearchBody({ q: 'acme', authzClause: authz, mode: 'full' });
      expect(boolOf(body).must[0].multi_match).toMatchObject({ query: 'acme', fuzziness: 'AUTO', operator: 'and' });
    });

    it('leaves a mixed text-and-digits query on the text path', () => {
      const body = buildSearchBody({ q: 'john 8370', authzClause: authz, mode: 'full' });
      expect(boolOf(body).must[0].multi_match.query).toBe('john 8370');
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
