import {
  MAIN_NAV,
  SETTINGS_ITEM,
  TECHNICIAN_NAV,
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
 * label refreshed), and the oldest entries fall off past HISTORY_LIMIT. A
 * visit under the same name as the newest crumb replaces it — one page, one
 * crumb, whichever path it re-landed on — as Workiz's strip never shows
 * "PAYMENTS # PAYMENTS".
 */
export function pushVisit(
  history: PageVisit[],
  visit: PageVisit,
): PageVisit[] {
  const last = history[history.length - 1];
  const base =
    last && last.path !== visit.path && last.label === visit.label
      ? history.slice(0, -1)
      : history;
  const next = base.filter((e) => e.path !== visit.path);
  next.push(visit);
  return next.slice(-HISTORY_LIMIT);
}

/** Trailing slash off ("/calls/" → "/calls"); the root stays "/". */
function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

/**
 * Routes that only hand the reader on — the `redirect()` pages under
 * `app/(app)` (`redirect-hops.test.ts` walks the tree to keep this list
 * honest). A hop is never a crumb: "/payments" lands on the Payments report,
 * and the strip names that page once.
 */
const REDIRECT_HOPS = new Set([
  "/payments",
  "/price-book",
  "/inventory",
  "/settings/general",
  "/settings/automations",
  "/settings/call-flows",
  "/settings/call-groups",
  "/settings/messaging",
  "/settings/message-templates",
  "/settings/phone-numbers",
]);
/** The inventory record routes: every one of them lands on its list (the record opens in a dialog). */
const REDIRECT_HOP_PATTERNS = [/^\/inventory\/(warehouses|containers|products|items)\/[^/]+$/];

/** True for a route that only redirects to another page. */
export function isRedirectHop(pathname: string): boolean {
  const path = normalizePath(pathname);
  return REDIRECT_HOPS.has(path) || REDIRECT_HOP_PATTERNS.some((p) => p.test(path));
}

/**
 * Record a navigation. An upgraded label registered for the path (by the
 * page itself, possibly before the visit lands — effect order on a re-visit
 * with cached data) wins over the generic route label. Registered labels for
 * paths that have fallen off the trail are dropped. A redirect hop records
 * nothing: the page it lands on is the visit.
 */
export function applyVisit(state: TrailState, path: string): TrailState {
  if (isRedirectHop(path)) return state;
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
  [SETTINGS_ITEM.href]: SETTINGS_ITEM.label,
  ...Object.fromEntries(
    MAIN_NAV.flatMap((g) => g.items.map((i) => [i.href, i.label])),
  ),
  // Where Workiz's crumb and its menu disagree, the crumb copies the crumb:
  // its Home page reads "… # DASHBOARD", its Workiz Phone page "… # CALLS".
  "/": "Dashboard",
  "/calls": "Calls",
  "/deals/new": "New Job",
  // The Price book's tabs: "Items" alone would read as Inventory's Items.
  "/price-book/items": "Price book",
  "/price-book/categories": "Price book Categories",
  "/price-book/brands": "Price book Brands",
  // Inventory's tabs, in Workiz's words ("… # INVENTORY # USER LOCATIONS").
  "/inventory/items": "Inventory",
  "/inventory/user-containers": "User locations",
  // The Phone section's tabs, as Workiz's breadcrumb names them ("Calls #
  // Numbers"); under /calls they would otherwise read as a single call.
  "/calls/numbers": "Numbers",
  "/calls/flows": "Call Flows",
  "/calls/groups": "Call groups",
  "/calls/devices": "Devices",
  "/calls/texting": "Text Messages",
  // Workiz's builder breadcrumb: "CALL FLOW BUILDER (128781)".
  "/calls/flows/new": "Call Flow Builder",
  "/profile": "My Profile",
  // Workiz's crumb for its Settings → Estimates page ("… # NUMBERING # SETTINGS # ESTIMATES SETTINGS").
  "/settings/estimates": "Estimates settings",
  ...Object.fromEntries(TECHNICIAN_NAV.map((i) => [i.href, i.label])),
};

/** Entity labels for detail pages, keyed by the collection route owning the id. */
const DETAIL_LABELS: Record<string, string> = {
  "/deals": "Job",
  "/my-jobs": "Job",
  // Workiz calls the page a client's ("… # DASHBOARD # CLIENT").
  "/contacts": "Client",
  "/companies": "Company",
  "/technicians": "Technician",
  "/calls": "Call",
  "/calls/flows": "Call Flow Builder",
  "/admin/roles": "Role",
  "/admin/users": "User",
  "/inventory/containers": "Container",
  "/inventory/warehouses": "Warehouse",
  "/inventory/items": "Item",
  // Workiz: "… # ESTIMATE (1)", "… # INVOICE (…)" — the page adds the number.
  "/estimates": "Estimate",
  "/invoices": "Invoice",
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
  const path = normalizePath(pathname);

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
