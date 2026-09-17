/**
 * How a deal line item is fulfilled:
 * - `sourced`  — a part pulled from an assigned technician's container (stock deducted).
 * - `to_order` — a part the technician does not carry, recorded to be ordered (no stock).
 * - `service`  — a non-stockable service/labor line (no stock, no source technician).
 * - `imported` — a historical line carried over from Workiz. It never moved
 *   BitCRM stock (the opening snapshot already reflects it), so removing or
 *   replacing it restores nothing, and its money is whatever Workiz recorded.
 *   The API never accepts this value; only the importer writes it.
 */
export type DealProductFulfillment =
  | 'sourced'
  | 'to_order'
  | 'service'
  | 'imported';

/**
 * Where the line's client price came from:
 * - `catalog`  — the product's list price, unchanged.
 * - `override` — set by hand within the ±15% band the add-item dialog enforces.
 * - `imported` — recorded by Workiz. 128 460 of the 156 612 matched historical
 *   lines differ from today's catalog price and 110 865 sit outside ±15%, so
 *   the band must not judge them.
 *
 * Absent on every line BitCRM has written so far — readers must cope, and
 * "absent" is what they must treat as "the ±15% band applies".
 *
 * Only `imported` is written by anything today (the Workiz importer);
 * `catalog` and `override` are reserved for the add-item dialog and are not
 * produced by any current code path, so do not branch on them.
 */
export type DealProductPriceSource = 'catalog' | 'override' | 'imported';

export interface DealProduct {
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  costCompany: number;
  costForTech: number;
  priceClient: number;
  /** Which assigned technician's container this line was pulled from. */
  sourceTechId?: string;
  /**
   * How this line is fulfilled. Missing on rows written before the field existed —
   * readers must treat an absent value as `'sourced'`.
   */
  fulfillment?: DealProductFulfillment;
  /** Where `priceClient` came from. Missing on everything written before import. */
  priceSource?: DealProductPriceSource;
  /** For `to_order` lines: ISO timestamp set when the line is marked ordered. */
  orderedAt?: string;
  /**
   * Whether the job's tax rate applies to this line. Missing on legacy rows —
   * readers must treat an absent value as `true` (Workiz default).
   */
  taxable?: boolean;
  /** Optional client-facing description shown on estimates/invoices. */
  description?: string;
  addedBy: string;
  addedAt: string;
  /** Set when the line was last edited (quantity/price change or product swap). */
  updatedBy?: string;
  updatedAt?: string;
}
