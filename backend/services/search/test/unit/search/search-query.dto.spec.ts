import { normalizeSearchQuery } from 'src/search/dto/search-query.dto';

describe('normalizeSearchQuery', () => {
  it('defaults to typeahead mode and trims the query', () => {
    const n = normalizeSearchQuery({ q: '  acme  ' });
    expect(n.q).toBe('acme');
    expect(n.mode).toBe('typeahead');
  });

  it('coerces and clamps numeric params (no ValidationPipe in this repo)', () => {
    const n = normalizeSearchQuery({ q: 'x', mode: 'full', page: '3', size: '999', limit: '50' });
    expect(n.page).toBe(3);
    expect(n.size).toBe(50); // clamped to MAX_SIZE
    expect(n.perTypeLimit).toBe(10); // clamped to MAX_PER_TYPE
  });

  it('falls back to safe defaults for garbage numbers', () => {
    const n = normalizeSearchQuery({ q: 'x', page: 'abc', size: '-4' });
    expect(n.page).toBe(1);
    expect(n.size).toBe(20);
  });

  it('parses a csv type filter and drops invalid types', () => {
    const n = normalizeSearchQuery({ q: 'x', type: 'deal, contact ,bogus' });
    expect(n.types).toEqual(['deal', 'contact']);
  });

  it('leaves types undefined when none valid', () => {
    const n = normalizeSearchQuery({ q: 'x', type: 'bogus,nope' });
    expect(n.types).toBeUndefined();
  });
});
