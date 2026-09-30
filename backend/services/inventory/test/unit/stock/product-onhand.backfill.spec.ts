import { sumOnHand } from 'src/stock/product-onhand.backfill';

/**
 * `onHand` на рядку товару — сума рядків STOCK# по всіх складах і фургонах.
 * Бекфіл рахує її один раз для товарів, записаних до появи поля.
 */
describe('sumOnHand', () => {
  it('sums one product across warehouses and containers', () => {
    const totals = sumOnHand([
      { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p1', productId: 'p1', quantity: 10 },
      { PK: 'CONTAINER#c-1', SK: 'STOCK#p1', productId: 'p1', quantity: 4 },
      { PK: 'CONTAINER#c-2', SK: 'STOCK#p1', productId: 'p1', quantity: 0 },
    ]);

    expect(totals).toEqual(new Map([['p1', 14]]));
  });

  it('keeps products apart', () => {
    const totals = sumOnHand([
      { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p1', productId: 'p1', quantity: 1 },
      { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p2', productId: 'p2', quantity: 2 },
    ]);

    expect(totals.get('p1')).toBe(1);
    expect(totals.get('p2')).toBe(2);
  });

  it('takes the product id from the sort key when the row has none', () => {
    expect(sumOnHand([{ PK: 'CONTAINER#c-1', SK: 'STOCK#p9', quantity: 3 }])).toEqual(
      new Map([['p9', 3]]),
    );
  });

  it('counts an unreadable quantity as zero, not NaN', () => {
    const totals = sumOnHand([
      { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p1', productId: 'p1', quantity: 'five' },
      { PK: 'CONTAINER#c-1', SK: 'STOCK#p1', productId: 'p1', quantity: 2 },
      { PK: 'CONTAINER#c-2', SK: 'STOCK#p1', productId: 'p1' },
    ]);

    expect(totals.get('p1')).toBe(2);
  });

  it('ignores rows that are not location stock', () => {
    const totals = sumOnHand([
      { PK: 'PRODUCT#p1', SK: 'METADATA', quantity: 99 },
      { PK: 'WAREHOUSE#wh-1', SK: 'METADATA', quantity: 99 },
      { PK: 'DEAL#d-1', SK: 'STOCK#p1', productId: 'p1', quantity: 99 },
      { PK: 'WAREHOUSE#wh-1', SK: 'STOCK#p1', productId: 'p1', quantity: 1 },
    ]);

    expect(totals).toEqual(new Map([['p1', 1]]));
  });

  it('is empty for no rows', () => {
    expect(sumOnHand([])).toEqual(new Map());
  });
});
