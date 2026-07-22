import type { JobTag } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** Deal-service catalog lives under the deals gateway route. */
const BASE = "/deals/job-tags";

export const listJobTags = (): Promise<JobTag[]> => http.get<JobTag[]>(BASE);

export const getJobTag = (id: string): Promise<JobTag> =>
  http.get<JobTag>(`${BASE}/${id}`);

export const createJobTag = (body: unknown): Promise<JobTag> =>
  http.post<JobTag>(BASE, body);

export const updateJobTag = (id: string, body: unknown): Promise<JobTag> =>
  http.put<JobTag>(`${BASE}/${id}`, body);

export const deleteJobTag = (
  id: string,
): Promise<{ id: string; archived: boolean; deleted: boolean }> =>
  http.delete<{ id: string; archived: boolean; deleted: boolean }>(`${BASE}/${id}`);
