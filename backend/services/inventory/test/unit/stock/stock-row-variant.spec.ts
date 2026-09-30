import { BadRequestException } from '@nestjs/common';
import {
  guessStockRowVariant,
  stockRowVariant,
  type StockLeg,
} from 'src/stock/stock-row-variant';

/**
 * `uniqueItems` на складі/фургоні — скільки різних товарів там лежить
 * (рядків STOCK# з quantity > 0). Запис стоку рухає його на ±1 рівно тоді,
 * коли рядок перетинає 0 ↔ >0. Скільки було, до запису не відомо, тож
 * транзакція несе умову на рядок STOCK#, яка істинна саме для того
 * попереднього стану, під який порахована дельта: інший стан — відмова,
 * перечитування, повтор. Ніколи не "прочитали, а потім записали" без умови.
 */
describe('stockRowVariant', () => {
  const add = (quantity: number): StockLeg => ({ pk: 'CONTAINER#c-1', productId: 'p-1', quantity, direction: 'add' });
  const take = (quantity: number): StockLeg => ({ pk: 'CONTAINER#c-1', productId: 'p-1', quantity, direction: 'take' });

  /** Evaluates a variant's condition against a stored quantity (null = no row / no quantity). */
  function holds(variant: ReturnType<typeof stockRowVariant>, leg: StockLeg, stored: number | null): boolean {
    const values: Record<string, number> = { ':qty': leg.quantity, ...(variant.values as Record<string, number>) };
    const cond = variant.condition;
    const q = stored;
    // A tiny evaluator for the shapes the variants use — enough to prove they partition the states.
    const clauses = cond
      .replace('attribute_not_exists(#quantity)', 'ABSENT')
      .split(' OR ')
      .map((c) => c.replace(/[()]/g, '').trim());
    return clauses.some((clause: string) =>
      clause.split(' AND ').every((atom: string) => {
        const a = atom.trim();
        if (a === 'ABSENT') return q === null;
        const m = a.match(/^#quantity (>|<=|=|>=) (:\w+)$/);
        if (!m) throw new Error(`unexpected atom ${a}`);
        if (q === null) return false;
        const v = values[m[2]];
        if (m[1] === '>') return q > v;
        if (m[1] === '<=') return q <= v;
        if (m[1] === '>=') return q >= v;
        return q === v;
      }),
    );
  }

  describe('adding units', () => {
    it('counts a product the location did not hold (no row): +1', () => {
      const variant = stockRowVariant(add(5), null);
      expect(variant.uniqueDelta).toBe(1);
      expect(holds(variant, add(5), null)).toBe(true);
    });

    it('counts a row sitting at zero: +1', () => {
      expect(stockRowVariant(add(5), 0).uniqueDelta).toBe(1);
    });

    it('leaves a product it already held alone: 0', () => {
      const variant = stockRowVariant(add(5), 3);
      expect(variant.uniqueDelta).toBe(0);
      expect(holds(variant, add(5), 3)).toBe(true);
    });

    it('a negative row that stays at or below zero is not counted: 0', () => {
      expect(stockRowVariant(add(2), -5).uniqueDelta).toBe(0);
      expect(stockRowVariant(add(5), -5).uniqueDelta).toBe(0);
    });

    it('a negative row that climbs above zero is counted: +1', () => {
      expect(stockRowVariant(add(6), -5).uniqueDelta).toBe(1);
    });

    // The condition is what makes it race-free: it must be true for exactly
    // the stored states that give the same delta, and false for all others.
    it.each([null, -9, -5, -4, -1, 0, 1, 2, 7])('the +1 and 0 conditions partition every stored state (%p)', (stored) => {
      const leg = add(5);
      const plus = stockRowVariant(leg, null);
      const zero = stockRowVariant(leg, 3);
      const expected = stockRowVariant(leg, stored).uniqueDelta;
      expect(holds(plus, leg, stored)).toBe(expected === 1);
      expect(holds(zero, leg, stored)).toBe(expected === 0);
    });
  });

  describe('taking units', () => {
    it('leaves a product that is still held alone: 0, under "more than taken"', () => {
      const variant = stockRowVariant(take(3), 10);
      expect(variant.uniqueDelta).toBe(0);
      expect(variant.condition).toBe('#quantity > :qty');
      expect(variant.values).toEqual({});
    });

    it('emptying the row takes the product off the count: -1, under "exactly what was taken"', () => {
      const variant = stockRowVariant(take(3), 3);
      expect(variant.uniqueDelta).toBe(-1);
      expect(variant.condition).toBe('#quantity = :qty');
    });

    it('is insufficient stock when the row holds less than is taken', () => {
      expect(() => stockRowVariant(take(3), 2)).toThrow(BadRequestException);
      expect(() => stockRowVariant(take(3), 2)).toThrow('Insufficient stock for product p-1');
    });

    it('is insufficient stock when there is no row at all', () => {
      expect(() => stockRowVariant(take(1), null)).toThrow(BadRequestException);
    });

    it.each([0, 1, 2, 3, 4, 10])('the two conditions admit only a row that can give the units (%p)', (stored) => {
      const leg = take(3);
      expect(holds(stockRowVariant(leg, 10), leg, stored)).toBe(stored > 3);
      expect(holds(stockRowVariant(leg, 3), leg, stored)).toBe(stored === 3);
    });
  });

  describe('the first attempt, before anything is read', () => {
    it('assumes an add lands on a product the location already holds', () => {
      const variant = guessStockRowVariant(add(5));
      expect(variant).toEqual(stockRowVariant(add(5), 1));
      expect(variant.uniqueDelta).toBe(0);
    });

    it('assumes a take leaves some behind', () => {
      const variant = guessStockRowVariant(take(2));
      expect(variant).toEqual(stockRowVariant(take(2), 99));
    });
  });

  it('never asks DynamoDB for a value the expression does not use', () => {
    for (const [leg, stored] of [
      [add(5), null],
      [add(5), 3],
      [take(3), 10],
      [take(3), 3],
    ] as const) {
      const variant = stockRowVariant(leg, stored);
      for (const name of Object.keys(variant.values)) {
        expect(variant.condition).toContain(name);
      }
    }
  });
});
