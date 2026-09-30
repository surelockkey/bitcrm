import { BadRequestException } from '@nestjs/common';

/**
 * One stock row a write touches: units go into (`add`) or out of (`take`)
 * one product at one location. `quantity` is always positive.
 */
export interface StockLeg {
  /** WAREHOUSE#<id> | CONTAINER#<id> — the location's partition. */
  pk: string;
  productId: string;
  quantity: number;
  direction: 'add' | 'take';
  /** The catalog name an `add` stores on the row. */
  productName?: string;
}

/**
 * What a stock write does to the location's `uniqueItems` (stock rows with
 * quantity > 0), and the condition on the stock row under which that is the
 * right delta.
 *
 * The delta depends on the quantity BEFORE the write, which a TransactWrite
 * cannot read. So the write carries the condition: it is true for exactly the
 * stored states that give this delta. If the row is in another state, the
 * whole transaction is refused — stock, totals and `onHand` alike — and the
 * caller reads the row and tries again with the variant for what it found.
 * No interleaving can apply a delta computed for a different state.
 *
 * `values` holds only the names the condition adds; `:qty` (the units moved,
 * positive) is already on every stock update.
 */
export interface StockRowVariant {
  uniqueDelta: -1 | 0 | 1;
  condition: string;
  values: Record<string, number>;
}

const held = (quantity: number) => quantity > 0;

function insufficient(leg: StockLeg): BadRequestException {
  return new BadRequestException(`Insufficient stock for product ${leg.productId}`);
}

/**
 * The variant for `leg` written onto a row that holds `stored` (null: no row,
 * or a row with no quantity). A `take` from a row that cannot give the units
 * is insufficient stock — the 400 every deduct answers.
 *
 * Adding q units:  held before (> 0) or still ≤ 0 after (stored ≤ -q) → 0;
 *                  absent, or -q < stored ≤ 0 → +1.
 * Taking q units:  stored > q → 0; stored = q → -1 (the row empties);
 *                  anything less → insufficient.
 */
export function stockRowVariant(leg: StockLeg, stored: number | null): StockRowVariant {
  if (leg.direction === 'take') {
    if (stored === null || !(stored >= leg.quantity)) throw insufficient(leg);
    return stored === leg.quantity
      ? { uniqueDelta: -1, condition: '#quantity = :qty', values: {} }
      : { uniqueDelta: 0, condition: '#quantity > :qty', values: {} };
  }

  const values = { ':zero': 0, ':negQty': -leg.quantity };
  const before = stored ?? 0;
  const counted = stored === null || (!held(before) && held(before + leg.quantity));
  return counted
    ? {
        uniqueDelta: 1,
        condition: 'attribute_not_exists(#quantity) OR (#quantity <= :zero AND #quantity > :negQty)',
        values,
      }
    : { uniqueDelta: 0, condition: '#quantity > :zero OR #quantity <= :negQty', values };
}

/**
 * The first attempt, before anything is read: the common case — an add lands
 * on a product the location already holds, a take leaves some behind. A wrong
 * guess costs one refused transaction and one read, never a wrong count.
 */
export function guessStockRowVariant(leg: StockLeg): StockRowVariant {
  return stockRowVariant(leg, leg.direction === 'add' ? 1 : leg.quantity + 1);
}
