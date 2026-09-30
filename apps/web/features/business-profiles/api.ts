import type { BusinessProfileView } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import type { CompanyWriteBody } from "./schemas";

export { uploadAsset, AssetUploadError } from "@/features/documents/api";

/** Companies (business profiles) live in the billing service. */
const BASE = "/billing/business-profiles";

/** Every company, archived included, default first then by name. */
export const listBusinessProfiles = (): Promise<BusinessProfileView[]> =>
  http.get<BusinessProfileView[]>(`${BASE}?includeInactive=true`);

export const getBusinessProfile = (id: string): Promise<BusinessProfileView> =>
  http.get<BusinessProfileView>(`${BASE}/${encodeURIComponent(id)}`);

/** The first company created becomes the default. */
export const createBusinessProfile = (body: CompanyWriteBody): Promise<BusinessProfileView> =>
  http.post<BusinessProfileView>(BASE, body);

/** Partial; `null` clears an optional field (incl. `logoAssetId`). */
export const updateBusinessProfile = (
  id: string,
  body: Partial<CompanyWriteBody>,
): Promise<BusinessProfileView> => http.put<BusinessProfileView>(`${BASE}/${encodeURIComponent(id)}`, body);

/** Makes it the single default (it must be active). */
export const setDefaultBusinessProfile = (id: string): Promise<BusinessProfileView> =>
  http.post<BusinessProfileView>(`${BASE}/${encodeURIComponent(id)}/default`);

/** 409 when it's the default or a template auto-applies to it. */
export const deleteBusinessProfile = (id: string): Promise<unknown> =>
  http.delete<unknown>(`${BASE}/${encodeURIComponent(id)}`);
