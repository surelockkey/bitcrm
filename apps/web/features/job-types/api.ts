import type { JobType } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** Deal-service catalog lives under the deals gateway route. */
const BASE = "/deals/job-types";

export const listJobTypes = (): Promise<JobType[]> => http.get<JobType[]>(BASE);

export const getJobType = (id: string): Promise<JobType> =>
  http.get<JobType>(`${BASE}/${id}`);

export const createJobType = (body: unknown): Promise<JobType> =>
  http.post<JobType>(BASE, body);

export const updateJobType = (id: string, body: unknown): Promise<JobType> =>
  http.put<JobType>(`${BASE}/${id}`, body);

export const deleteJobType = (
  id: string,
): Promise<{ id: string; archived: boolean; deleted: boolean }> =>
  http.delete<{ id: string; archived: boolean; deleted: boolean }>(`${BASE}/${id}`);
