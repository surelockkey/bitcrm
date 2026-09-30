"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getDealsByIds } from "@/features/deals/api";
import { fetchTimesheetEntries, fetchTimesheetReport } from "./api";
import type { EntryJob } from "./lib";

/** The report's own keys — under `reports`, not `technicians`, so a clock-in elsewhere does not re-read a year. */
export const timesheetKeys = {
  page: (params: string) => ["reports", "timesheets", "page", params] as const,
  entries: (params: string) => ["reports", "timesheets", "entries", params] as const,
  jobs: (ids: string[]) => ["reports", "timesheets", "jobs", ids] as const,
};

/** A page of the report; the previous one stays on screen while the next loads. */
export function useTimesheetReport(params: string) {
  return useQuery({
    queryKey: timesheetKeys.page(params),
    queryFn: () => fetchTimesheetReport(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** One person's entries — asked for only once their row is opened. */
export function useTimesheetEntries(params: string, enabled: boolean) {
  return useQuery({
    queryKey: timesheetKeys.entries(params),
    queryFn: () => fetchTimesheetEntries(params),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Job number and name for the entries' jobs — the Job and Job name columns.
 * The jobs live in deal-service; they are hydrated a hundred at a time
 * (`POST /deals/by-ids`), and one the viewer may not see simply stays blank.
 */
export function useEntryJobs(dealIds: string[], enabled = true) {
  const ids = [...new Set(dealIds)].sort();
  return useQuery({
    queryKey: timesheetKeys.jobs(ids),
    queryFn: async () => {
      const out = new Map<string, EntryJob>();
      for (let i = 0; i < ids.length; i += 100) {
        const deals = await getDealsByIds(ids.slice(i, i + 100));
        for (const d of deals) {
          const name = (d as { jobName?: string }).jobName;
          out.set(d.id, { number: d.dealNumber, ...(name ? { name } : {}) });
        }
      }
      return out;
    },
    enabled: enabled && ids.length > 0,
    staleTime: 5 * 60_000,
  });
}
