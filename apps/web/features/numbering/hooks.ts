"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";

/** Settings → Numbering. Needs `settings.view`. */
export function useNumbering(enabled = true) {
  return useQuery({
    queryKey: queryKeys.numbering(),
    queryFn: api.getNumbering,
    enabled,
    staleTime: 60_000,
  });
}

/**
 * Saves the next numbers. The server's refusals ("Next Invoice Id must be
 * more than the last number (85426)") are the page's to show under the
 * field, so no toast on error here.
 */
export function useUpdateNumbering() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: api.NumberingBody) => api.updateNumbering(body),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.numbering(), settings);
      toast.success("Numbering saved");
    },
  });
}
