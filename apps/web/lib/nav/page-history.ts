import {
  MAIN_NAV,
  OVERVIEW_ITEM,
  SETTINGS_ITEM,
} from "@/lib/nav/nav-config";

/** One entry in the recently-visited trail. */
export interface PageVisit {
  path: string;
  label: string;
}

/** How many visited pages the trail keeps. */
export const HISTORY_LIMIT = 6;

/**
 * Append a visit to the trail: a path already present moves to the end (its
 * label refreshed), and the oldest entries fall off past HISTORY_LIMIT.
 */
export function pushVisit(
  history: PageVisit[],
  visit: PageVisit,
): PageVisit[] {
  const next = history.filter((e) => e.path !== visit.path);
  next.push(visit);
  return next.slice(-HISTORY_LIMIT);
}

/** Exact-path labels: sidebar nav plus routes that aren't in the sidebar. */
const STATIC_LABELS: Record<string, string> = {
  [OVERVIEW_ITEM.href]: OVERVIEW_ITEM.label,
  [SETTINGS_ITEM.href]: SETTINGS_ITEM.label,
  ...Object.fromEntries(
    MAIN_NAV.flatMap((g) => g.items.map((i) => [i.href, i.label])),
  ),
  "/deals/new": "New Job",
  "/profile": "My Profile",
};

/** First-segment labels for detail pages (`/deals/:id` → "Job"). */
const DETAIL_LABELS: Record<string, string> = {
  deals: "Job",
  contacts: "Contact",
  companies: "Company",
  technicians: "Technician",
};

/** "/settings/job-types" → "Job Types" */
function humanize(segment: string): string {
  return segment
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Default label for a pathname. Detail pages get a generic entity label
 * ("Job") that the page itself upgrades once its data loads
 * (see usePageHistoryLabel).
 */
export function labelForPath(pathname: string): string {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  const staticLabel = STATIC_LABELS[path];
  if (staticLabel) return staticLabel;

  const segments = path.split("/").filter(Boolean);
  const detailLabel =
    segments.length === 2 ? DETAIL_LABELS[segments[0]] : undefined;
  if (detailLabel) return detailLabel;

  const last = segments[segments.length - 1];
  return last ? humanize(last) : "Dashboard";
}
