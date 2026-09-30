"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { JobsReportSettings } from "@bitcrm/types";
import { fetchJobsReport, fetchJobsReportSettings, saveJobsReportSettings } from "./api";

/** The report's own keys — not under `deals`, so the jobs live stream does not re-read a year on every edit. */
export const jobsReportKeys = {
  page: (params: string) => ["reports", "jobs", "page", params] as const,
  settings: () => ["reports", "jobs", "settings"] as const,
};

/**
 * A page of the report. The previous page stays on screen while the next
 * one loads, so the table does not blink on every page turn or filter tick.
 */
export function useJobsReport(params: string, enabled = true) {
  return useQuery({
    queryKey: jobsReportKeys.page(params),
    queryFn: () => fetchJobsReport(params),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 30_000,
  });
}

export function useJobsReportSettings() {
  return useQuery({
    queryKey: jobsReportKeys.settings(),
    queryFn: fetchJobsReportSettings,
    staleTime: 5 * 60_000,
  });
}

export function useSaveJobsReportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<JobsReportSettings>) => saveJobsReportSettings(body),
    onSuccess: (saved) => qc.setQueryData(jobsReportKeys.settings(), saved),
  });
}
