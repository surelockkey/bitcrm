import { InventoryStatus } from '../enums/inventory-status.enum';

/** A manufacturer/brand a product belongs to. Flat — brands have no hierarchy. */
export interface Brand {
  id: string;
  name: string;
  description?: string;
  photoKey?: string;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * A product category. Categories nest one parent deep or more via `parentId`.
 * Archiving a category cascades to its descendants and to the products filed
 * under it — matching the warning Workiz shows on the toggle.
 */
export interface ProductCategory {
  id: string;
  name: string;
  description?: string;
  photoKey?: string;
  /** Absent for a top-level category. */
  parentId?: string;
  status: InventoryStatus;
  createdAt: string;
  updatedAt: string;
}

/** A category plus the counts the settings table renders. */
export interface ProductCategoryWithCounts extends ProductCategory {
  parentName?: string;
  activeItemCount: number;
}
