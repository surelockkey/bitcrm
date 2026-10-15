import { lineCosts } from 'src/deals/deal-line-rules';

/**
 * Workiz's "Add job item" popup has a Cost box beside Quantity and Price: the
 * line's own cost, prefilled from the price book. Only the office sees it
 * (`financials.view`); a technician's phone never had the number, so what it
 * sends can't be the source. Once set, a line keeps its cost — an edit of the
 * quantity does not pull the price book's again (Workiz freezes it on the
 * line); a swap to another item starts from that item's.
 */
describe('lineCosts — what a job line costs the company', () => {
  const catalog = { costCompany: 15, costTech: 20 };

  it('a new line takes the price book costs when the caller may not set one', () => {
    expect(lineCosts(catalog, { costCompany: 1 }, { mayCost: false })).toEqual({ costCompany: 15, costForTech: 20 });
  });

  it('the office types a cost on a new line', () => {
    expect(lineCosts(catalog, { costCompany: 12.5 }, { mayCost: true })).toEqual({ costCompany: 12.5, costForTech: 20 });
  });

  it('the office sends none: the price book', () => {
    expect(lineCosts(catalog, {}, { mayCost: true })).toEqual({ costCompany: 15, costForTech: 20 });
  });

  it('a cost that is not a non-negative number is ignored', () => {
    expect(lineCosts(catalog, { costCompany: -3 }, { mayCost: true }).costCompany).toBe(15);
    expect(lineCosts(catalog, { costCompany: Number.NaN }, { mayCost: true }).costCompany).toBe(15);
  });

  it('zero is a cost', () => {
    expect(lineCosts(catalog, { costCompany: 0 }, { mayCost: true }).costCompany).toBe(0);
  });

  it('an in-place edit without a cost keeps the line’s own', () => {
    const existing = { productId: 'p1', costCompany: 10, costForTech: 12 };
    expect(lineCosts(catalog, { productId: 'p1' }, { mayCost: false, existing })).toEqual({ costCompany: 10, costForTech: 12 });
  });

  it('the office retypes the cost on an edit', () => {
    const existing = { productId: 'p1', costCompany: 10, costForTech: 12 };
    expect(lineCosts(catalog, { productId: 'p1', costCompany: 7 }, { mayCost: true, existing })).toEqual({ costCompany: 7, costForTech: 12 });
  });

  it('a swap to another item starts from that item’s price book costs', () => {
    const existing = { productId: 'p1', costCompany: 10, costForTech: 12 };
    expect(lineCosts(catalog, { productId: 'p2' }, { mayCost: false, existing })).toEqual({ costCompany: 15, costForTech: 20 });
  });

  it('writes zero for a cost the price book does not carry', () => {
    expect(lineCosts({}, {}, { mayCost: false })).toEqual({ costCompany: 0, costForTech: 0 });
  });
});
