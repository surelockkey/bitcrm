import { type Deal } from '@bitcrm/types';

/**
 * Does the job still have money owed on it? Workiz's "Show unpaid jobs".
 *
 * Read off what the job row already carries, never off billing: `totals.total`
 * (refreshed on every line, tax or discount change), `amountPaid` (billing's
 * ledger sum, asserted on every payment change), `totals.amountDue` (Workiz's
 * own figure on an imported job's snapshot) and `paymentStatus` (billing's
 * flag; on an imported job, Workiz's own). First answer wins:
 *
 *  1. Nothing to pay (no total, or $0) → no.
 *  2. The ledger has spoken (`amountPaid` present) → the total is above it. This
 *     is what catches a job paid in full and then given another line: its
 *     `paymentStatus` still says `paid` until the next payment event.
 *  3. An imported job the ledger has not touched → Workiz's amount due is above
 *     zero (exactly what Workiz's own checkbox reads).
 *  4. Otherwise → the job is not marked `paid`.
 *
 * Exact comparisons, no cent of slack: it must agree row for row with
 * `BALANCE_DUE_FILTER`, and a DynamoDB condition cannot do arithmetic.
 */
export function hasBalanceDue(deal: Pick<Deal, 'totals' | 'amountPaid' | 'paymentStatus'>): boolean {
  const total = deal.totals?.total;
  if (typeof total !== 'number' || !(total > 0)) return false;
  if (typeof deal.amountPaid === 'number') return total > deal.amountPaid;
  const workizDue = deal.totals?.amountDue;
  if (typeof workizDue === 'number') return workizDue > 0;
  return deal.paymentStatus !== 'paid';
}

/** `hasBalanceDue` as a FilterExpression fragment — the two must stay in step. */
export const BALANCE_DUE_FILTER = {
  expression:
    '#totals.#total > :noMoney AND (' +
    '(attribute_exists(#amountPaid) AND #totals.#total > #amountPaid) OR ' +
    '(attribute_not_exists(#amountPaid) AND attribute_exists(#totals.#amountDue) AND #totals.#amountDue > :noMoney) OR ' +
    '(attribute_not_exists(#amountPaid) AND attribute_not_exists(#totals.#amountDue) AND ' +
    '(attribute_not_exists(#paymentStatus) OR #paymentStatus <> :paidStatus)))',
  names: {
    '#totals': 'totals',
    '#total': 'total',
    '#amountDue': 'amountDue',
    '#amountPaid': 'amountPaid',
    '#paymentStatus': 'paymentStatus',
  },
  values: { ':noMoney': 0, ':paidStatus': 'paid' },
} as const;
