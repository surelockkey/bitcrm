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
  /**
   * The group's own cost of ONE unit (Workiz's member "Cost", what the group's
   * Margin is worked out from). Only for a caller with `financials.view`, and
   * never what a job line costs — "Add group" takes the price book's.
   */
  cost?: number;
}

/**
 * Workiz's two kinds of group: "Individual items" (`separate_items` — every
 * member its own line on the job, estimate or invoice) and "Flat rate" (one
 * line for the whole group). BitCRM adds Individual items groups; a Flat rate
 * group is listed and edited but not added to a job.
 */
export const ITEM_GROUP_TYPES = ['separate_items', 'flat_rate'] as const;
export type ItemGroupType = (typeof ITEM_GROUP_TYPES)[number];

/** Workiz's status box over the groups (`groupIsEnabledFilter`). */
export const ITEM_GROUP_STATUSES = ['active', 'disabled', 'all'] as const;
export type ItemGroupStatus = (typeof ITEM_GROUP_STATUSES)[number];

/**
 * Workiz "item group": a named set of price-book items added to a job (or an
 * estimate) in one go, each as its own line. Made in the Price book's Item
 * groups tab, or brought by the Workiz import.
 *
 * Stored in BitCRM_Inventory as `ITEM_GROUP#<id>` / `METADATA` with the
 * members inline (`members`), listed off GSI1 `CATALOG#ITEM_GROUP` (sort key:
 * the name lowercased).
 */
export interface ItemGroup {
  id: string;
  /** Unique across the groups, case-insensitively. */
  name: string;
  /** `''` when none. */
  description: string;
  /** Workiz "Group type"; `separate_items` when the row names none. */
  groupType: ItemGroupType;
  /** The item category it is filed under (`ProductCategory.id`), when any. */
  categoryId?: string;
  /**
   * Offered in the pickers (Workiz "Active"). A disabled group is kept — job
   * lines name it — and comes back by switching it on. The import's
   * `isEnabled` reads as this until BitCRM writes `active`.
   */
  active: boolean;
  members: ItemGroupMember[];
  /** Σ quantity × priceClient over the members, rounded to cents. */
  total: number;
  /** `workiz:item_group:<id>` on imported groups. */
  externalId?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}
