import { type Product } from '@bitcrm/types';

/** A price-book amount as a line stores it: a finite number, else 0. */
const amount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * A job line's costs, copied from the price book entry the server itself just
 * read from inventory — never from the request. Inventory leaves `costCompany`
 * out of every catalog answer for a caller without `financials.view` (the
 * technician, the dispatcher), so the client cannot be the source; and no
 * client ever sent anything but the catalog's own two numbers.
 */
export function catalogCosts(
  product: Pick<Product, 'costCompany' | 'costTech'>,
): { costCompany: number; costForTech: number } {
  return { costCompany: amount(product.costCompany), costForTech: amount(product.costTech) };
}
