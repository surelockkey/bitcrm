"use client";

import { useJobTypes } from "@/features/job-types/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useExternalCompanies } from "@/features/external-companies/hooks";
import { useActiveBusinessProfiles } from "@/features/business-profiles/hooks";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTags } from "@/features/job-tags/hooks";

/**
 * Everything a job's fields need that does not depend on the job.
 *
 * Each of these used to be fetched by the select that shows it, and those
 * selects only mount once the job has arrived — so nothing a field needed was
 * even asked for until then, and a dispatcher watched the page fill in waves.
 *
 * Called at the top of the job page they go out together with the job itself,
 * in one wave. They share their query keys with the selects, so the selects
 * render from cache rather than fetching again, and the five-minute staleTime
 * means the next job opens with nothing left to fetch at all.
 *
 * `ready` is what lets the page wait for the whole picture instead of showing
 * a field the moment its own data lands: one skeleton, then the page.
 */
export function useJobPageCatalogs(): { ready: boolean } {
  const queries = [
    useJobTypes(),
    useJobSources(),
    useExternalCompanies(),
    useActiveBusinessProfiles(),
    useCustomFields(),
    useJobStatuses(),
    useJobTags(),
  ];
  // A catalog that failed must not hold the page hostage — a dispatcher with
  // one empty dropdown is better off than one staring at a spinner.
  return { ready: queries.every((q) => q.data !== undefined || q.isError) };
}
