/**
 * One line of an item group — what "Add group" puts on a job as its own line.
 * The quantity, price, taxable flag, description and custom field values are
 * the group's own (Workiz keeps them per member, apart from the price book);
 * the costs are not here — a job line takes them from the price book.
 */
export interface ItemGroupMember {
  /** The price-book product (`Product.id`). */
  productId: string;
  /** The line's name as the group shows it (Workiz member `description`). */
  name: string;
  quantity: number;
  /** The client price of ONE unit, as the group sets it. */
  priceClient: number;
  taxable: boolean;
  /** The line's long description (Workiz `desc_long`); `''` when none. */
  description: string;
  /** Custom field values keyed by the field NAME, as on `Product`; `{}` when none. */
  customAttributes: Record<string, string>;
}

/**
 * Workiz "item group" (`groupType: separate_items`): a named set of price-book
 * items added to a job in one go, each as its own line.
 *
 * Stored in BitCRM_Inventory as `ITEM_GROUP#<id>` / `METADATA` with the
 * members inline (`members`), listed off GSI1 `CATALOG#ITEM_GROUP` (sort key:
 * the name lowercased). The Workiz import writes these rows.
 */
export interface ItemGroup {
  id: string;
  name: string;
  /** `''` when none. */
  description: string;
  members: ItemGroupMember[];
  /** Σ quantity × priceClient over the members, rounded to cents. */
  total: number;
  /** `workiz:item_group:<id>` on imported groups. */
  externalId?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}
