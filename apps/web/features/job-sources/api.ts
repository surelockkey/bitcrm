import type { JobSource } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** Deal-service catalog lives under the deals gateway route. */
const BASE = "/deals/job-sources";

export const listJobSources = (): Promise<JobSource[]> => http.get<JobSource[]>(BASE);

export const getJobSource = (id: string): Promise<JobSource> =>
  http.get<JobSource>(`${BASE}/${id}`);

export const createJobSource = (body: unknown): Promise<JobSource> =>
  http.post<JobSource>(BASE, body);

export const updateJobSource = (id: string, body: unknown): Promise<JobSource> =>
  http.put<JobSource>(`${BASE}/${id}`, body);

export const deleteJobSource = (
  id: string,
): Promise<{ id: string; archived: boolean; deleted: boolean }> =>
  http.delete<{ id: string; archived: boolean; deleted: boolean }>(`${BASE}/${id}`);
