import type { ExternalCompany } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** Deal-service catalog lives under the deals gateway route. */
const BASE = "/deals/external-companies";

export const listExternalCompanies = (): Promise<ExternalCompany[]> =>
  http.get<ExternalCompany[]>(BASE);

export const getExternalCompany = (id: string): Promise<ExternalCompany> =>
  http.get<ExternalCompany>(`${BASE}/${id}`);

export const createExternalCompany = (body: unknown): Promise<ExternalCompany> =>
  http.post<ExternalCompany>(BASE, body);

export const updateExternalCompany = (id: string, body: unknown): Promise<ExternalCompany> =>
  http.put<ExternalCompany>(`${BASE}/${id}`, body);

export const deleteExternalCompany = (
  id: string,
): Promise<{ id: string; archived: boolean; deleted: boolean }> =>
  http.delete<{ id: string; archived: boolean; deleted: boolean }>(`${BASE}/${id}`);
