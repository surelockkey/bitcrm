import {
  numberFromExternalId,
  planProductNumbers,
} from 'src/products/product-number.backfill';

/**
 * Товари, створені до появи `number`, і імпортовані з Workiz рядки без нього.
 * Імпортовані беруть свій Workiz item id, решта — з лічильника, піднятого
 * вище за найбільший уже зайнятий номер.
 */
describe('numberFromExternalId', () => {
  it('reads the Workiz item id', () => {
    expect(numberFromExternalId('workiz:item:10707')).toBe(10707);
  });

  it('ignores every other external id shape', () => {
    expect(numberFromExternalId('workiz:job:10707')).toBeUndefined();
    expect(numberFromExternalId('workiz:item:')).toBeUndefined();
    expect(numberFromExternalId('workiz:item:12ab')).toBeUndefined();
    expect(numberFromExternalId('10707')).toBeUndefined();
  });

  it('ignores a missing or non-string value', () => {
    expect(numberFromExternalId(undefined)).toBeUndefined();
    expect(numberFromExternalId(null)).toBeUndefined();
    expect(numberFromExternalId(10707)).toBeUndefined();
  });
});

describe('planProductNumbers', () => {
  it('skips rows that already have a number but counts them toward the ceiling', () => {
    const plan = planProductNumbers([
      { PK: 'PRODUCT#a', number: 500 },
      { PK: 'PRODUCT#b' },
    ]);

    expect(plan.imported).toEqual([]);
    expect(plan.pending).toEqual(['PRODUCT#b']);
    expect(plan.max).toBe(500);
  });

  it('gives an imported row its Workiz item id', () => {
    const plan = planProductNumbers([
      { PK: 'PRODUCT#a', externalId: 'workiz:item:10707' },
      { PK: 'PRODUCT#b', externalId: 'workiz:item:42' },
    ]);

    expect(plan.imported).toEqual([
      { PK: 'PRODUCT#a', number: 10707 },
      { PK: 'PRODUCT#b', number: 42 },
    ]);
    expect(plan.pending).toEqual([]);
    expect(plan.max).toBe(10707);
  });

  it('leaves the rest for the counter, in scan order', () => {
    const plan = planProductNumbers([
      { PK: 'PRODUCT#a' },
      { PK: 'PRODUCT#b', externalId: 'workiz:item:7' },
      { PK: 'PRODUCT#c', externalId: 'not-workiz' },
    ]);

    expect(plan.imported).toEqual([{ PK: 'PRODUCT#b', number: 7 }]);
    expect(plan.pending).toEqual(['PRODUCT#a', 'PRODUCT#c']);
    expect(plan.max).toBe(7);
  });

  it('keeps an existing number even when the row also has a Workiz id', () => {
    const plan = planProductNumbers([{ PK: 'PRODUCT#a', number: 3, externalId: 'workiz:item:99' }]);

    expect(plan.imported).toEqual([]);
    expect(plan.max).toBe(3);
  });

  it('has a zero ceiling when nothing is numbered yet', () => {
    expect(planProductNumbers([{ PK: 'PRODUCT#a' }]).max).toBe(0);
    expect(planProductNumbers([]).max).toBe(0);
  });
});
