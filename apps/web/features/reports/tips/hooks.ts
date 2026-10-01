"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchTipsReport, fetchTipsReportJobs } from "./api";

/** The report's own keys — not under `deals`, so the jobs live stream does not re-read a period on every edit. */
export const tipsReportKeys = {
  page: (params: string) => ["reports", "tips", "page", params] as const,
  jobs: (params: string) => ["reports", "tips", "jobs", params] as const,
};

/** The period's lines; the previous ones stay on screen while the next load, so the table does not blink. */
export function useTipsReport(params: string) {
  return useQuery({
    queryKey: tipsReportKeys.page(params),
    queryFn: () => fetchTipsReport(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** A person's jobs, while their row is open. */
export function useTipsReportJobs(params: string) {
  return useQuery({
    queryKey: tipsReportKeys.jobs(params),
    queryFn: () => fetchTipsReportJobs(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
