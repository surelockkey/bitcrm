import type {
  Brand,
  ListCount,
  PaginatedResponse,
  Product,
  ProductCategory,
  ProductStock,
} from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";
import type { CreateProductValues, PatchProductValues } from "./schemas";
import type { ProductFilter } from "./lib";

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

/** Every filter the caller set, as the list and its count both read them. */
function filterParams(filter: ProductFilter): Record<string, string | undefined> {
  return {
    category: filter.category,
    type: filter.type,
    status: filter.status,
    search: filter.search,
    // `false` is a filter of its own ("not stock-managed"), not an absence.
    manageStock: filter.manageStock === undefined ? undefined : String(filter.manageStock),
    brandId: filter.brandId,
  };
}

function toQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) q.set(key, value);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function listProducts(
  filter: ProductFilter,
  cursor?: string,
  limit = 50,
): Promise<PaginatedResponse<Product>> {
  return apiFetchPaginated<Product>(
    `/inventory/products${toQuery({ ...filterParams(filter), cursor, limit: String(limit) })}`,
  );
}

/** Скільки товарів під цим фільтром — число для «Page 2 of 7». */
export function countProducts(filter: ProductFilter): Promise<ListCount> {
  return http.get<ListCount>(
    `/inventory/products/count${toQuery(filterParams(filter))}`,
  );
}

export function getProduct(id: string): Promise<Product> {
  return http.get<Product>(`/inventory/products/${id}`);
}

/**
 * Where one item sits: every warehouse and van the caller may see, with the
 * quantity each holds (0 included) and `onHand` summed over those rows.
 */
export function getProductStock(id: string): Promise<ProductStock> {
  return http.get<ProductStock>(`/inventory/stock/products/${id}`);
}

/* --- Catalogs the item pickers read (archived rows included; filter on `active`) --- */

export function listItemCategories(): Promise<ProductCategory[]> {
  return http.get<ProductCategory[]>("/inventory/categories");
}

export function listBrands(): Promise<Brand[]> {
  return http.get<Brand[]>("/inventory/brands");
}

export function getProductBySku(sku: string): Promise<Product> {
  return http.get<Product>(`/inventory/products/sku/${encodeURIComponent(sku)}`);
}

export function getProductByBarcode(code: string): Promise<Product> {
  return http.get<Product>(`/inventory/products/barcode/${encodeURIComponent(code)}`);
}

export function createProduct(body: CreateProductValues): Promise<Product> {
  return http.post<Product>("/inventory/products", body);
}

/** Partial body: only the fields the caller means to change are validated. */
export function updateProduct(
  id: string,
  body: PatchProductValues,
): Promise<Product> {
  return http.put<Product>(`/inventory/products/${id}`, body);
}

/** Soft-archive (status → archived). */
export function archiveProduct(id: string): Promise<Product> {
  return http.delete<Product>(`/inventory/products/${id}`);
}

export function reactivateProduct(id: string): Promise<Product> {
  return http.post<Product>(`/inventory/products/${id}/reactivate`);
}

export function importProducts(file: File, dryRun = false): Promise<ImportResult> {
  const form = new FormData();
  form.append("file", file);
  return http.postForm<ImportResult>(
    `/inventory/products/import${dryRun ? "?dryRun=1" : ""}`,
    form,
  );
}

/* --- Photo: presigned upload/download + remove --- */

export function getPhotoUploadUrl(
  id: string,
  contentType: string,
): Promise<{ uploadUrl: string; key: string }> {
  return http.post<{ uploadUrl: string; key: string }>(
    `/inventory/products/${id}/photo/upload-url`,
    { contentType },
  );
}

/**
 * The bytes are in S3: the server makes the list's thumbnail from them. An
 * older server has no such step and answers 404 — the upload is done anyway.
 */
export async function completePhotoUpload(id: string): Promise<void> {
  try {
    await http.post<unknown>(`/inventory/products/${id}/photo/complete`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return;
    throw e;
  }
}

export function getPhotoDownloadUrl(id: string): Promise<{ downloadUrl: string }> {
  return http.get<{ downloadUrl: string }>(`/inventory/products/${id}/photo`);
}

export function removePhoto(id: string): Promise<Product> {
  return http.delete<Product>(`/inventory/products/${id}/photo`);
}

/** Upload the raw bytes straight to S3 via the presigned URL (no auth header). */
export async function uploadPhotoBytes(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "image/jpeg" },
    body: file,
  });
  if (!res.ok) throw new Error("Photo upload failed");
}
