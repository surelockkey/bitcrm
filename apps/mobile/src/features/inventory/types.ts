/**
 * What the van is, to a phone.
 *
 * Both shapes come from `@bitcrm/types` — the inventory service's own
 * declarations — so a field it renames breaks this build rather than reaching
 * a technician as a blank quantity.
 */

import type { Container as InventoryContainer } from '@bitcrm/types';

export type { StockItem } from '@bitcrm/types';

/**
 * The container, narrowed to what a technician's screen reads.
 *
 * `GET /inventory/containers/my` returns the whole entity, but the phone only
 * ever shows its name (and the department under it), and the id it needs to
 * ask for stock. Everything else — `status`, the audit stamps — belongs to the
 * office's table view, and narrowing here means a cached row written by an
 * older build cannot be a type error at a call site that never reads them.
 */
export type MyContainer = Pick<InventoryContainer, 'id' | 'name'> &
  Partial<Pick<InventoryContainer, 'department' | 'technicianName' | 'description'>>;

/**
 * One line of the van list.
 *
 * `StockItem` is the whole of it today: the inventory service denormalizes
 * `productName` onto the stock row, so the list needs no catalog join to be
 * readable. SKU, category and a low-stock mark live on `Product` and are
 * deliberately not fetched here — see `lib.ts`.
 */
export interface StockRow {
  productId: string;
  name: string;
  quantity: number;
}
