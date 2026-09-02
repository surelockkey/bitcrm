/**
 * Item (product) brand/manufacturer, managed as a catalog in Settings.
 * Structurally identical to ProductCategory.
 */
export interface Brand {
  id: string;
  name: string;
  /** Archived brands leave the pickers but stay on existing items. */
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
