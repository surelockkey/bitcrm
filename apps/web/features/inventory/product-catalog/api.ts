import type { Brand, ProductCategory, ProductCategoryWithCounts } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/* --------------------------------------------------------------- brands */

export const listBrands = (): Promise<Brand[]> => http.get<Brand[]>("/inventory/brands");

export const createBrand = (body: unknown): Promise<Brand> =>
  http.post<Brand>("/inventory/brands", body);

export const updateBrand = (id: string, body: unknown): Promise<Brand> =>
  http.put<Brand>(`/inventory/brands/${id}`, body);

export const archiveBrand = (id: string): Promise<Brand> =>
  http.put<Brand>(`/inventory/brands/${id}/archive`);

export const reactivateBrand = (id: string): Promise<Brand> =>
  http.put<Brand>(`/inventory/brands/${id}/reactivate`);

/* ----------------------------------------------------------- categories */

export const listProductCategories = (): Promise<ProductCategoryWithCounts[]> =>
  http.get<ProductCategoryWithCounts[]>("/inventory/product-categories");

export const createProductCategory = (body: unknown): Promise<ProductCategory> =>
  http.post<ProductCategory>("/inventory/product-categories", body);

export const updateProductCategory = (id: string, body: unknown): Promise<ProductCategory> =>
  http.put<ProductCategory>(`/inventory/product-categories/${id}`, body);

/** Archiving cascades: the response is the whole subtree that went with it. */
export const archiveProductCategory = (id: string): Promise<ProductCategory[]> =>
  http.put<ProductCategory[]>(`/inventory/product-categories/${id}/archive`);

export const reactivateProductCategory = (id: string): Promise<ProductCategory> =>
  http.put<ProductCategory>(`/inventory/product-categories/${id}/reactivate`);
