"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";

/**
 * Only the job types a picker can still offer.
 *
 * The full catalog is what resolves the name of an archived type on an old
 * job, and it is large: 898 came over from Workiz. A dropdown needs the 21 that are active, so it asks for those and
 * nothing else, under its own key so the two never evict one another.
 */
export function useActiveJobTypes() {
  return useQuery({
    queryKey: queryKeys.jobTypes.active(),
    queryFn: () => api.listJobTypes(true),
    staleTime: 5 * 60_000,
  });
}
