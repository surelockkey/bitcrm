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

/**
 * The whole trail: the visits themselves plus the upgraded labels detail
 * pages have registered ("Job (3QI2BN)"), kept per path so a re-visit can't
 * downgrade an entry back to its generic label.
 */
export interface TrailState {
  visits: PageVisit[];
  labels: Record<string, string>;
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

/**
 * Record a navigation. An upgraded label registered for the path (by the
 * page itself, possibly before the visit lands — effect order on a re-visit
 * with cached data) wins over the generic route label. Registered labels for
 * paths that have fallen off the trail are dropped.
 */
export function applyVisit(state: TrailState, path: string): TrailState {
  const label = state.labels[path] ?? labelForPath(path);
  const visits = pushVisit(state.visits, { path, label });
  const labels = Object.fromEntries(
    Object.entries(state.labels).filter(([p]) =>
      visits.some((v) => v.path === p),
    ),
  );
  return { visits, labels };
}

/**
 * Upgrade a page's label once its data is known ("Job" → "Job (3QI2BN)").
 * Updates the trail entry in place and remembers the label for the path so
 * later visits keep it, whichever order the effects fire in.
 */
export function applyLabel(
  state: TrailState,
  path: string,
  label: string,
): TrailState {
  return {
    visits: state.visits.map((v) => (v.path === path ? { ...v, label } : v)),
    labels: { ...state.labels, [path]: label },
  };
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

/** Entity labels for detail pages, keyed by the collection route owning the id. */
const DETAIL_LABELS: Record<string, string> = {
  "/deals": "Job",
  "/contacts": "Contact",
  "/companies": "Company",
  "/technicians": "Technician",
  "/calls": "Call",
  "/admin/roles": "Role",
  "/admin/users": "User",
  "/inventory/containers": "Container",
  "/inventory/warehouses": "Warehouse",
  "/inventory/items": "Item",
};

/** True for segments that are ids (UUIDs, hex blobs, call SIDs, numeric ids). */
function looksLikeId(segment: string): boolean {
  return /^[0-9a-f-]{16,}$/i.test(segment) || /^\d{6,}$/.test(segment);
}

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
 * (see usePageHistoryLabel). A raw id never renders: an unknown detail route
 * falls back to its collection segment ("/widgets/<uuid>" → "Widgets").
 */
export function labelForPath(pathname: string): string {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  const staticLabel = STATIC_LABELS[path];
  if (staticLabel) return staticLabel;

  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return "Dashboard";

  const detailLabel = DETAIL_LABELS["/" + segments.slice(0, -1).join("/")];
  if (detailLabel) return detailLabel;

  if (looksLikeId(last) && segments.length > 1)
    return humanize(segments[segments.length - 2]);

  return humanize(last);
}
