import {
  containerSubtitle,
  containerTitle,
  filterStock,
  sortStock,
  summarizeStock,
  summaryLine,
  toStockRows,
} from './lib';
import type { StockItem, StockRow } from './types';

const item = (over: Partial<StockItem> = {}): StockItem => ({
  productId: 'p1',
  productName: 'Kwikset deadbolt',
  quantity: 4,
  updatedAt: '2026-09-17T08:00:00.000Z',
  ...over,
});

const row = (over: Partial<StockRow> = {}): StockRow => ({
  productId: 'p1',
  name: 'Kwikset deadbolt',
  quantity: 4,
  ...over,
});

describe('toStockRows', () => {
  it('keeps the product name the stock row already carries', () => {
    expect(toStockRows([item()])).toEqual([
      { productId: 'p1', name: 'Kwikset deadbolt', quantity: 4 },
    ]);
  });

  it('drops a part the van has run out of', () => {
    // The container remembers a product at zero. A technician scanning for
    // what they have should not read past rows saying they have none.
    const rows = toStockRows([item(), item({ productId: 'p2', quantity: 0 })]);
    expect(rows.map((r) => r.productId)).toEqual(['p1']);
  });

  it('never shows a blank line where a name should be', () => {
    expect(toStockRows([item({ productName: '   ' })])[0]!.name).toBe('Unnamed part');
  });

  it('keeps a negative quantity out of the list rather than showing "-2"', () => {
    // Inventory can go negative when a job is closed against stock the van did
    // not have. That is the office's problem to reconcile, not a line a
    // technician can act on at the back doors.
    expect(toStockRows([item({ quantity: -2 })])).toEqual([]);
  });
});

describe('filterStock', () => {
  const rows = [
    row({ productId: 'p1', name: 'Kwikset deadbolt' }),
    row({ productId: 'p2', name: 'Schlage 3/4 inch valve' }),
    row({ productId: 'p3', name: 'Brass key blank' }),
  ];

  it('returns everything for an empty or whitespace search', () => {
    expect(filterStock(rows, '')).toHaveLength(3);
    expect(filterStock(rows, '   ')).toHaveLength(3);
  });

  it('needs every word to match, so two words narrow rather than widen', () => {
    // The web's rule (`features/tech/lib.ts:227`) — a part found at the desk
    // has to be findable in the van by the same words.
    expect(filterStock(rows, '3/4 valve').map((r) => r.productId)).toEqual(['p2']);
    expect(filterStock(rows, 'brass deadbolt')).toEqual([]);
  });

  it('ignores case, because nobody capitalises on a phone keyboard', () => {
    expect(filterStock(rows, 'KWIKSET').map((r) => r.productId)).toEqual(['p1']);
  });

  it('matches mid-word, so half a part name still finds it', () => {
    expect(filterStock(rows, 'bolt').map((r) => r.productId)).toEqual(['p1']);
  });
});

describe('sortStock', () => {
  it('runs A–Z so the eye can scan one column', () => {
    const sorted = sortStock([
      row({ productId: 'p2', name: 'Zinc strike plate' }),
      row({ productId: 'p1', name: 'Brass key blank' }),
      row({ productId: 'p3', name: 'kwikset deadbolt' }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual([
      'Brass key blank',
      'kwikset deadbolt',
      'Zinc strike plate',
    ]);
  });

  it('does not reorder what it was given', () => {
    const rows = [row({ productId: 'p2', name: 'B' }), row({ productId: 'p1', name: 'A' })];
    sortStock(rows);
    expect(rows.map((r) => r.name)).toEqual(['B', 'A']);
  });
});

describe('summarizeStock and summaryLine', () => {
  it('counts parts and pieces separately — they answer different questions', () => {
    const summary = summarizeStock([row({ quantity: 4 }), row({ productId: 'p2', quantity: 10 })]);
    expect(summary).toEqual({ skuCount: 2, totalUnits: 14 });
  });

  it('reads as words at arm’s length', () => {
    expect(summaryLine({ skuCount: 12, totalUnits: 148 })).toBe('12 items · 148 on hand');
    expect(summaryLine({ skuCount: 1, totalUnits: 1 })).toBe('1 item · 1 on hand');
    expect(summaryLine({ skuCount: 0, totalUnits: 0 })).toBe('0 items · 0 on hand');
  });
});

describe('containerTitle', () => {
  it('prefers the van’s own name', () => {
    expect(containerTitle({ name: 'Van 7', technicianName: 'Ada Byron' })).toBe('Van 7');
  });

  it('falls back to the technician before the word', () => {
    expect(containerTitle({ name: '  ', technicianName: 'Ada Byron' })).toBe('Ada Byron');
    expect(containerTitle({ name: '', technicianName: '' })).toBe('My van');
  });

  it('shows a department only when there is one', () => {
    expect(containerSubtitle({ department: 'Locksmith' })).toBe('Locksmith');
    expect(containerSubtitle({ department: '   ' })).toBeUndefined();
    expect(containerSubtitle({})).toBeUndefined();
  });
});
