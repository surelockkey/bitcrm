"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";
import type { AgingParams, EstimateReportParams, InvoiceReportParams, TaxReportParams } from "./lib";

export function useAging(params: AgingParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.aging(params),
    queryFn: () => api.getAging(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useInvoiceReportSummary(params: Pick<InvoiceReportParams, "from" | "to">, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.reportSummary(params),
    queryFn: () => api.getInvoiceReportSummary(params),
    enabled,
  });
}

export function useInvoiceReport(params: Omit<InvoiceReportParams, "cursor">, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.invoices.report(params),
    queryFn: ({ pageParam }) => api.listInvoiceReport({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
}

export function useInvoiceReportCount(params: Omit<InvoiceReportParams, "cursor" | "limit">, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.reportCount(params),
    queryFn: () => api.countInvoiceReport(params),
    staleTime: 30_000,
    enabled,
  });
}

export function useEstimateReportSummary(params: Pick<EstimateReportParams, "from" | "to">, enabled = true) {
  return useQuery({
    queryKey: queryKeys.estimates.reportSummary(params),
    queryFn: () => api.getEstimateReportSummary(params),
    enabled,
  });
}

export function useEstimateReport(params: Omit<EstimateReportParams, "cursor">, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.estimates.report(params),
    queryFn: ({ pageParam }) => api.listEstimateReport({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
}

export function useEstimateReportCount(params: Omit<EstimateReportParams, "cursor" | "limit">, enabled = true) {
  return useQuery({
    queryKey: queryKeys.estimates.reportCount(params),
    queryFn: () => api.countEstimateReport(params),
    staleTime: 30_000,
    enabled,
  });
}

export function useTaxReport(params: TaxReportParams, enabled = true) {
  return useQuery({
    queryKey: queryKeys.taxReport(params),
    queryFn: () => api.getTaxReport(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}
