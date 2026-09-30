"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";

/**
 * Only the job sources a picker can still offer.
 *
 * The full catalog is what resolves the name of an archived source on an old
 * job, and it is large: 690 came over from Workiz. A dropdown needs the 239 that are active, so it asks for those and
 * nothing else, under its own key so the two never evict one another.
 */
export function useActiveJobSources() {
  return useQuery({
    queryKey: queryKeys.jobSources.active(),
    queryFn: () => api.listJobSources(true),
    staleTime: 5 * 60_000,
  });
}
