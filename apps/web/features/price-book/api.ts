import type { Brand, ProductCategory } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/**
 * The Price Book's own writes: the item categories and brands catalogs.
 *
 * Items themselves, and both catalogs' lists, go through the Inventory API
 * (`features/inventory/products/api`) — one catalog, one client.
 *
 * Archiving is `active: false` on the same PUT, and restoring `active: true`.
 * DELETE is not used: on a category it removes the row outright when no item
 * is filed under it, and on a brand always — neither can be undone.
 */

/** What a catalog row carries: a name, unique per catalog (409 on a clash), and whether it's offered. */
export interface CatalogCreateBody {
  name: string;
  active?: boolean;
}

export type CatalogUpdateBody = Partial<CatalogCreateBody>;

export function createItemCategory(body: CatalogCreateBody): Promise<ProductCategory> {
  return http.post<ProductCategory>("/inventory/categories", body);
}

export function updateItemCategory(id: string, body: CatalogUpdateBody): Promise<ProductCategory> {
  return http.put<ProductCategory>(`/inventory/categories/${encodeURIComponent(id)}`, body);
}

export function createBrand(body: CatalogCreateBody): Promise<Brand> {
  return http.post<Brand>("/inventory/brands", body);
}

export function updateBrand(id: string, body: CatalogUpdateBody): Promise<Brand> {
  return http.put<Brand>(`/inventory/brands/${encodeURIComponent(id)}`, body);
}
