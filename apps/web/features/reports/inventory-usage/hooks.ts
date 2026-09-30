"use client";

import { useMemo } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useDealsByIds } from "@/features/deals/hooks";
import { fetchReportSummary, listReportPage } from "./api";
import type { ReportLogEntry, ReportQuery, ReportTab } from "./types";

/** The report's own cache root: nothing else reads it, and a visit a minute later reads nothing. */
export const reportKeys = {
  all: () => ["inventory-report"] as const,
  list: (tab: ReportTab, query: ReportQuery, limit: number) =>
    ["inventory-report", tab, "list", query, limit] as const,
  summary: (tab: ReportTab, query: ReportQuery) => ["inventory-report", tab, "summary", query] as const,
};

const STALE = 30_000;

/**
 * A tab's rows, a server page at a time. The previous filter's rows stay on
 * screen, dimmed, while the next set loads — the table never collapses to a
 * skeleton and back on a filter change.
 */
export function useReportRows<T extends ReportTab>(tab: T, query: ReportQuery, limit: number) {
  return useInfiniteQuery({
    queryKey: reportKeys.list(tab, query, limit),
    queryFn: ({ pageParam }) => listReportPage(tab, query, pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    placeholderData: keepPreviousData,
    staleTime: STALE,
  });
}

/** The tab's row count and totals, for the whole filtered window. */
export function useReportSummary(tab: ReportTab, query: ReportQuery) {
  return useQuery({
    queryKey: reportKeys.summary(tab, query),
    queryFn: () => fetchReportSummary(tab, query),
    placeholderData: keepPreviousData,
    staleTime: STALE,
  });
}

/**
 * dealId → job number for the log entries on screen that name a job but not
 * its number — one `POST /deals/by-ids` for the page, and only for a reader
 * who may see jobs (the link would be closed to anyone else anyway).
 */
export function useJobNumbers(entries: ReportLogEntry[], enabled: boolean): Map<string, string | number> {
  const ids = useMemo(
    () =>
      [...new Set(entries.filter((e) => e.dealId && e.dealNumber === undefined).map((e) => e.dealId as string))].sort(),
    [entries],
  );
  const deals = useDealsByIds(ids, enabled);
  return useMemo(
    () => new Map((deals.data ?? []).map((d) => [d.id, d.dealNumber] as [string, string | number])),
    [deals.data],
  );
}
