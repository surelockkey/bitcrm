"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CommissionReport } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { queryKeys } from "@/lib/query-keys";
import { ApiError } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";
import { commissionReportParams, type CommissionReportFilters } from "./lib";

const BASE = "/deals/reports/commissions";

/**
 * One page of the report with its Totals. The previous page stays on screen
 * while the next loads, so paging and sorting do not flash an empty table.
 */
export function useCommissionReport(filters: CommissionReportFilters | null) {
  const params = filters ? commissionReportParams(filters) : null;
  return useQuery({
    queryKey: queryKeys.reports.commissions(params),
    queryFn: () => http.get<CommissionReport>(`${BASE}?${new URLSearchParams(params!)}`),
    enabled: params !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * Export: every row of the filtered set as CSV, built by the server. Fetched
 * with the Bearer header (a plain link could not carry it) and saved.
 */
export async function downloadCommissionCsv(filters: CommissionReportFilters): Promise<void> {
  const all = commissionReportParams({ ...filters, offset: undefined, limit: undefined });
  const res = await fetch(`${env.apiBaseUrl}${BASE}/export?${new URLSearchParams(all)}`, {
    headers: { Authorization: `Bearer ${getIdToken() ?? ""}` },
  });
  if (!res.ok) throw new ApiError(res.status, `Export failed (${res.status})`);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `commissions_${filters.from}_${filters.to}.csv`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
