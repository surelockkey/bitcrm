"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchItemsReport, fetchItemsReportJobs } from "./api";

/** The report's own keys — not under `deals`, so the jobs live stream does not re-read a period on every edit. */
export const itemsReportKeys = {
  page: (params: string) => ["reports", "items", "page", params] as const,
  jobs: (params: string) => ["reports", "items", "jobs", params] as const,
};

/** A page of the report; the previous one stays on screen while the next loads. */
export function useItemsReport(params: string, enabled = true) {
  return useQuery({
    queryKey: itemsReportKeys.page(params),
    queryFn: () => fetchItemsReport(params),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 30_000,
  });
}

/** One item's jobs — asked only while its row is open. */
export function useItemsReportJobs(params: string, enabled: boolean) {
  return useQuery({
    queryKey: itemsReportKeys.jobs(params),
    queryFn: () => fetchItemsReportJobs(params),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 30_000,
  });
}
