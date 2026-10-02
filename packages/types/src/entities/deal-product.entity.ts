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
 * - `group`    — the item group's own price for the member (`POST
 *   /deals/:id/item-groups/:groupId`). A group sets its prices apart from the
 *   price book, so the band does not judge them either — while the line keeps
 *   that price.
 *
 * Absent on every single line BitCRM writes — readers must cope, and
 * "absent" is what they must treat as "the ±15% band applies".
 *
 * Written today: `imported` (the Workiz importer) and `group` (an item group
 * added to a job). `catalog` and `override` are reserved for the add-item
 * dialog and are not produced by any current code path, so do not branch on them.
 */
export type DealProductPriceSource = 'catalog' | 'override' | 'imported' | 'group';

export interface DealProduct {
  /**
   * The line's own id — what its row is keyed by, so one job can carry the
   * same product on two lines (a Workiz job routinely does: 19 506 such
   * lines in 8 765 pairs). Rows written before this field read it back as
   * their `productId`, which is exactly the key they were stored under.
   */
  lineId: string;
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
  /**
   * Whether the job's discount reaches this line. Absent ⇒ `true`; only the
   * Workiz importer writes `false` today — for Workiz's card service fee and
   * its non-discountable lines, which Workiz leaves out of the discount (see
   * `calculateDocumentTotals`).
   */
  discountable?: boolean;
  /** Optional client-facing description shown on estimates/invoices. */
  description?: string;
  /**
   * The line's custom field values (Workiz "Edit item" on a job line), keyed
   * by the field NAME as `Product.customAttributes` is. Copied from the
   * product when the line is added (from the group, over the product's, when
   * it comes from an item group), then the line's own: editing them never
   * changes the product. Absent when the line has none.
   */
  customAttributes?: Record<string, string>;
  /** The item group the line was added from (`ItemGroup.id`). */
  itemGroupId?: string;
  addedBy: string;
  addedAt: string;
  /** Set when the line was last edited (quantity/price change or product swap). */
  updatedBy?: string;
  updatedAt?: string;
}
