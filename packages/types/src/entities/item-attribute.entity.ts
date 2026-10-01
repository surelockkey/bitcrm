/**
 * What a custom field holds — the three Workiz offers for items. `number` and
 * `quantity` are typed in as numbers; every value is stored as a string.
 */
export const ITEM_ATTRIBUTE_TYPES = ['text', 'number', 'quantity'] as const;
export type ItemAttributeType = (typeof ITEM_ATTRIBUTE_TYPES)[number];

/**
 * A custom field of the item (product) catalog — Workiz "Custom Fields" in
 * the Edit Item popup. One definition serves every item; an item's value is
 * kept in `Product.customAttributes` under the definition's NAME (not its id),
 * which is how the Workiz import writes it. Renaming a definition therefore
 * renames the key on every item that has a value, and deleting one removes it.
 *
 * Stored in BitCRM_Inventory as `ITEM_ATTRIBUTE#<id>` / `METADATA`, listed off
 * GSI1 `CATALOG#ITEM_ATTRIBUTE` (sort key: the name lowercased). The stored
 * attribute is `attrType`; the API names it `type`.
 */
export interface ItemAttribute {
  id: string;
  /** Trimmed; unique across the catalog, case-insensitively. */
  name: string;
  type: ItemAttributeType | string;
  /** Workiz "Visible On Item List". */
  visible: boolean;
  /** Always `items` — Workiz scopes custom fields by resource. */
  resource: string;
  /** `workiz:attribute:<id>` on imported definitions. */
  externalId?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}
