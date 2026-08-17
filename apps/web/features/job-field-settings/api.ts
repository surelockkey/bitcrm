import type { JobFieldSettings } from "@bitcrm/types";
import { http } from "@/lib/api/http";

const BASE = "/deals/job-field-settings";

export const getJobFieldSettings = (): Promise<JobFieldSettings> =>
  http.get<JobFieldSettings>(BASE);

export const updateJobFieldSettings = (body: JobFieldSettings): Promise<JobFieldSettings> =>
  http.put<JobFieldSettings>(BASE, body);
