/**
 * Item (product) category, managed as a catalog in Settings. Items reference a
 * category by name today; pickers read this catalog.
 *
 * Same name/active semantics, repository shape and settings UI as JobSource
 * (minus priority — categories list alphabetically).
 */
export interface ProductCategory {
  id: string;
  name: string;
  /** Archived categories leave the pickers but stay on existing items. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The sentinel category for items that have none. `Product.category` is
 * required (it is the CategoryIndex partition key, so it cannot be empty), and
 * Workiz leaves 13 195 of 15 832 price-book items without a category — the
 * importer writes this name for them, and the inventory service seeds the
 * matching catalog row on demand so the picker and the archive-on-delete rule
 * keep resolving it. Matched case-insensitively; stored in this exact spelling.
 */
export const UNCATEGORIZED_CATEGORY = 'Uncategorized';
