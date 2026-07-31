/**
 * How a deal line item is fulfilled:
 * - `sourced`  — a part pulled from an assigned technician's container (stock deducted).
 * - `to_order` — a part the technician does not carry, recorded to be ordered (no stock).
 * - `service`  — a non-stockable service/labor line (no stock, no source technician).
 */
export type DealProductFulfillment = 'sourced' | 'to_order' | 'service';

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
  /** For `to_order` lines: ISO timestamp set when the line is marked ordered. */
  orderedAt?: string;
  addedBy: string;
  addedAt: string;
  /** Set when the line was last edited (quantity/price change or product swap). */
  updatedBy?: string;
  updatedAt?: string;
}
