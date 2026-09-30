import {
  LOCATION_TOTALS_SEED,
  sumLocationStock,
  totalsReconcileWrite,
} from 'src/stock/location-totals.backfill';

/**
 * `totalUnits` / `uniqueItems` на рядку складу чи фургона — сума рядків
 * STOCK# цієї локації і кількість тих, де quantity > 0. Записи стоку їх
 * ведуть; бекфіл рахує їх для рядків, записаних до появи полів, і звіряє
 * решту.
 */
describe('sumLocationStock', () => {
  it('sums the units and counts the products held', () => {
    expect(sumLocationStock([{ quantity: 10 }, { quantity: 4 }, { quantity: 1 }])).toEqual({
      totalUnits: 15,
      uniqueItems: 3,
    });
  });

  // Рядок з нулем лишається після списання останнього — товару там нема.
  it('does not count a row at zero as a product held', () => {
    expect(sumLocationStock([{ quantity: 0 }, { quantity: 2 }])).toEqual({ totalUnits: 2, uniqueItems: 1 });
  });

  // Імпорт з Workiz може принести мінус: одиниці в сумі, але товару "нема".
  it('keeps a negative row in the units but not among the products held', () => {
    expect(sumLocationStock([{ quantity: -3 }, { quantity: 5 }])).toEqual({ totalUnits: 2, uniqueItems: 1 });
  });

  it('counts an unreadable quantity as zero, not NaN', () => {
    expect(sumLocationStock([{ quantity: 'five' }, {}, { quantity: '3' }])).toEqual({
      totalUnits: 3,
      uniqueItems: 1,
    });
  });

  it('is zero for an empty location', () => {
    expect(sumLocationStock([])).toEqual({ totalUnits: 0, uniqueItems: 0 });
  });
});

describe('totalsReconcileWrite', () => {
  it('writes nothing when the row already carries the right totals', () => {
    expect(
      totalsReconcileWrite({ totalUnits: 15, uniqueItems: 3 }, { totalUnits: 15, uniqueItems: 3 }),
    ).toBeNull();
  });

  // Умова — "рядок досі такий, яким його прочитали": запис стоку між
  // читанням і записом рухає підсумки тією ж транзакцією, і тоді запис
  // бекфілу відмовляє, а не затирає його.
  it('sets both totals, conditioned on the row still holding what was read', () => {
    expect(
      totalsReconcileWrite({ totalUnits: 0, uniqueItems: 0 }, { totalUnits: 15, uniqueItems: 3 }),
    ).toEqual({
      UpdateExpression: 'SET totalUnits = :units, uniqueItems = :items',
      ConditionExpression: 'attribute_exists(PK) AND totalUnits = :seenUnits AND uniqueItems = :seenItems',
      ExpressionAttributeValues: { ':units': 15, ':items': 3, ':seenUnits': 0, ':seenItems': 0 },
    });
  });

  it('pins a missing attribute as missing', () => {
    expect(totalsReconcileWrite({}, { totalUnits: 1, uniqueItems: 1 })).toEqual({
      UpdateExpression: 'SET totalUnits = :units, uniqueItems = :items',
      ConditionExpression:
        'attribute_exists(PK) AND attribute_not_exists(totalUnits) AND attribute_not_exists(uniqueItems)',
      ExpressionAttributeValues: { ':units': 1, ':items': 1 },
    });
  });

  it('treats a total that is not a number as missing', () => {
    const write = totalsReconcileWrite({ totalUnits: '15', uniqueItems: 3 }, { totalUnits: 15, uniqueItems: 3 });
    expect(write?.ConditionExpression).toBe(
      'attribute_exists(PK) AND attribute_not_exists(totalUnits) AND uniqueItems = :seenItems',
    );
  });
});

/**
 * Перш ніж рахувати, рядок без підсумків отримує нулі: відтоді кожен запис
 * стоку рухає їх (умова attribute_exists(totalUnits) справджується), і
 * запис, що впаде між читанням STOCK# і записом суми, зіб'є умову, а не
 * загубиться.
 */
describe('LOCATION_TOTALS_SEED', () => {
  it('sets zero only where an attribute is missing, never over a kept total', () => {
    expect(LOCATION_TOTALS_SEED).toEqual({
      UpdateExpression:
        'SET totalUnits = if_not_exists(totalUnits, :zero), uniqueItems = if_not_exists(uniqueItems, :zero)',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':zero': 0 },
    });
  });
});
