import { DASHBOARD_TIMEZONE, type ActivityRow, type ActivitySort } from "@bitcrm/types";

/*
 * Activity, web side: the query the list, the count and the export share,
 * the Time column as Workiz prints it, and the CSV.
 */

export interface ActivityFilter {
  from: string;
  to: string;
  userIds: string[];
  q: string;
  sort: ActivitySort;
}

export function activityParams(filter: ActivityFilter, extra: { limit?: number; cursor?: string } = {}): string {
  const p = new URLSearchParams({ from: filter.from, to: filter.to });
  if (filter.userIds.length) p.set("userIds", filter.userIds.join(","));
  const q = filter.q.trim();
  if (q) p.set("q", q);
  if (filter.sort === "asc") p.set("sort", "asc");
  if (extra.limit) p.set("limit", String(extra.limit));
  if (extra.cursor) p.set("cursor", extra.cursor);
  return p.toString();
}

const TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: DASHBOARD_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/** "Tue Sep 29, 2026 05:54 pm" — Workiz's Time column, on the account's clock. */
export function activityTime(iso: string): string {
  const parts = Object.fromEntries(TIME.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

/**
 * The User column. An imported event keeps the name Workiz recorded; one of
 * ours is named from the team directory (the stored name is the actor's
 * e-mail), falling back to what was stored.
 */
export function activityUser(row: ActivityRow, directoryName: (id: string) => string | undefined): string {
  if (row.imported) return row.actorName;
  return directoryName(row.actorId) ?? row.actorName;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Workiz's four columns as CSV. */
export function activityCsv(rows: ActivityRow[], directoryName: (id: string) => string | undefined): string {
  const lines = [["Time", "User", "Action", "Job Id"].join(",")];
  for (const r of rows) {
    lines.push([activityTime(r.timestamp), activityUser(r, directoryName), r.text, r.jobRef ?? ""].map(csvCell).join(","));
  }
  return lines.join("\n");
}
