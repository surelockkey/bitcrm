import type { Product, PaginatedResponse } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import type { CreateProductValues, UpdateProductValues } from "./schemas";
import { effectiveProductQuery, type ProductFilter } from "./lib";

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
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
): Promise<PaginatedResponse<Product>> {
  return apiFetchPaginated<Product>(
    `/inventory/products${toQuery({ ...effectiveProductQuery(filter), cursor, limit: "50" })}`,
  );
}

export function getProduct(id: string): Promise<Product> {
  return http.get<Product>(`/inventory/products/${id}`);
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

export function updateProduct(
  id: string,
  body: UpdateProductValues,
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
