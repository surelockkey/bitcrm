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
