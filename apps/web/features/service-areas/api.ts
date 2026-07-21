import type { ServiceArea, CoverageShape } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** Deal-service catalog lives under the deals gateway route. */
const BASE = "/deals/service-areas";

export const listServiceAreas = (): Promise<ServiceArea[]> =>
  http.get<ServiceArea[]>(BASE);

export const getServiceArea = (id: string): Promise<ServiceArea> =>
  http.get<ServiceArea>(`${BASE}/${id}`);

export const createServiceArea = (body: unknown): Promise<ServiceArea> =>
  http.post<ServiceArea>(BASE, body);

export const updateServiceArea = (id: string, body: unknown): Promise<ServiceArea> =>
  http.put<ServiceArea>(`${BASE}/${id}`, body);

export const deleteServiceArea = (id: string): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`${BASE}/${id}`);

/** Derive coverage shapes for an unsaved definition (map preview). */
export const previewServiceArea = (body: unknown): Promise<CoverageShape[]> =>
  http.post<CoverageShape[]>(`${BASE}/preview`, body);

/** Resolve which area contains a point/address; null when outside every area. */
export const resolveServiceArea = (
  body: { lat?: number; lng?: number; address?: unknown },
): Promise<ServiceArea | null> => http.post<ServiceArea | null>(`${BASE}/resolve`, body);
