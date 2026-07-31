import type { DealSubStatus } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** Deal-service catalog lives under the deals gateway route. */
const BASE = "/deals/job-statuses";

export const listJobStatuses = (): Promise<DealSubStatus[]> =>
  http.get<DealSubStatus[]>(BASE);

export const getJobStatus = (id: string): Promise<DealSubStatus> =>
  http.get<DealSubStatus>(`${BASE}/${id}`);

export const createJobStatus = (body: unknown): Promise<DealSubStatus> =>
  http.post<DealSubStatus>(BASE, body);

export const updateJobStatus = (id: string, body: unknown): Promise<DealSubStatus> =>
  http.put<DealSubStatus>(`${BASE}/${id}`, body);

export const deleteJobStatus = (
  id: string,
): Promise<{ id: string; archived: boolean; deleted: boolean }> =>
  http.delete<{ id: string; archived: boolean; deleted: boolean }>(`${BASE}/${id}`);
