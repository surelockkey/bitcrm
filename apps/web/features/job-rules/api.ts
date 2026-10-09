import type { JobRulesSettings } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** The account's job rules (Workiz Account → Preferences): deal-service's `CONFIG#JOB_RULES`. */
const BASE = "/deals/job-rules";

export const getJobRules = (): Promise<JobRulesSettings> => http.get<JobRulesSettings>(BASE);

export const updateJobRules = (body: Partial<JobRulesSettings>): Promise<JobRulesSettings> =>
  http.put<JobRulesSettings>(BASE, body);
