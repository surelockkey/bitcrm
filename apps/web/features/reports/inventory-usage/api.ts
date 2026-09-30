import type { ListCount } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import type {
  InventoryUsageRow,
  ReportLogEntry,
  ReportQuery,
  ReportSummary,
  ReportTab,
  ReturnsSummary,
  UsageSummary,
} from "./types";

/** Each tab's rows. */
export interface TabRows {
  usage: InventoryUsageRow;
  returns: ReportLogEntry;
  log: ReportLogEntry;
}

/** A page of a tab, as the pager walks it. */
export interface ReportPage<T> {
  data: T[];
  pagination: { nextCursor?: string };
}

const LIST_PATH: Record<ReportTab, string> = {
  usage: "/inventory/reports/inventory-usage",
  returns: "/inventory/reports/inventory-returns",
  log: "/inventory/inventory-log",
};

const SUMMARY_PATH: Record<ReportTab, string> = {
  usage: "/inventory/reports/inventory-usage/summary",
  returns: "/inventory/reports/inventory-returns/summary",
  log: "/inventory/inventory-log/count",
};

/**
 * The query a tab sends. A group with several picks sends its param once per
 * pick (`techId=a&techId=b`), which the report endpoints read as a list.
 *
 * "Tech" means the job's technicians on the Usage tab and the person who did
 * the entry on the other two, whose rows are log entries — `userId` there.
 */
function queryOf(tab: ReportTab, query: ReportQuery, page?: { limit: number; cursor?: string }): string {
  const q = new URLSearchParams({ from: query.from, to: query.to });
  const techParam = tab === "usage" ? "techId" : "userId";
  for (const id of query.filters.techIds) q.append(techParam, id);
  for (const id of query.filters.locationIds) q.append("locationId", id);
  for (const name of query.filters.categories) q.append("category", name);
  for (const id of query.filters.brandIds) q.append("brandId", id);
  const search = query.search?.trim();
  if (search) q.set("search", search);
  if (page) {
    q.set("limit", String(page.limit));
    if (page.cursor) q.set("cursor", page.cursor);
  }
  return q.toString();
}

/** One page of a tab's rows, newest first. */
export async function listReportPage<T extends ReportTab>(
  tab: T,
  query: ReportQuery,
  cursor: string | undefined,
  limit: number,
): Promise<ReportPage<TabRows[T]>> {
  const body = await apiFetchPaginated<TabRows[T]>(
    `${LIST_PATH[tab]}?${queryOf(tab, query, { limit, cursor })}`,
  );
  return {
    data: body.data ?? [],
    pagination: { nextCursor: body.pagination?.nextCursor || undefined },
  };
}

/**
 * The row count behind "Page 2 of 7" and, on Usage and Returns, the Totals
 * row — for the whole filtered window, not the page on screen.
 */
export async function fetchReportSummary(tab: ReportTab, query: ReportQuery): Promise<ReportSummary> {
  const path = `${SUMMARY_PATH[tab]}?${queryOf(tab, query)}`;
  if (tab === "log") {
    const count = await http.get<ListCount>(path);
    return {
      ...(typeof count.total === "number" && { rows: count.total }),
      ...(count.atLeast !== undefined && { atLeast: count.atLeast }),
    };
  }
  return http.get<UsageSummary | ReturnsSummary>(path);
}
