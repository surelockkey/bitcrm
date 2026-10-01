"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SalesReportSettings } from "@bitcrm/types";
import { fetchSalesReport, fetchSalesReportSettings, saveSalesReportSettings } from "./api";

/** The report's own keys — not under `deals`, so the jobs live stream does not re-read a period on every edit. */
export const salesReportKeys = {
  page: (params: string) => ["reports", "sales", "page", params] as const,
  settings: () => ["reports", "sales", "settings"] as const,
};

/** A page of the report; the previous one stays on screen while the next loads. */
export function useSalesReport(params: string, enabled = true) {
  return useQuery({
    queryKey: salesReportKeys.page(params),
    queryFn: () => fetchSalesReport(params),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 30_000,
  });
}

export function useSalesReportSettings() {
  return useQuery({
    queryKey: salesReportKeys.settings(),
    queryFn: fetchSalesReportSettings,
    staleTime: 5 * 60_000,
  });
}

export function useSaveSalesReportSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<SalesReportSettings>) => saveSalesReportSettings(body),
    onSuccess: (saved) => qc.setQueryData(salesReportKeys.settings(), saved),
  });
}
