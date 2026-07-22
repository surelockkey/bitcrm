import {
  DataScope,
  DealStage,
  DealStageGroup,
  STAGE_GROUPS,
  TERMINAL_STAGES,
} from "@bitcrm/types";
import type { PermissionMatrix, DataScopeRules, Role } from "@bitcrm/types";

/** A resource schema: resource key → the actions valid for it. */
export type Schema = Record<string, readonly string[]>;

/* ------------------------------------------------------------------ *
 * Presentation
 * ------------------------------------------------------------------ */

export const RESOURCE_LABELS: Record<string, string> = {
  deals: "Deals",
  contacts: "Contacts",
  companies: "Companies",
  products: "Products",
  warehouses: "Warehouses",
  containers: "Containers",
  transfers: "Transfers",
  users: "Users",
  roles: "Roles",
  reports: "Reports",
  settings: "Settings",
  technicians: "Technicians",
  job_types: "Job Types",
  job_sources: "Job Sources",
  service_areas: "Service Areas",
  commission: "Commission",
  documents: "Documents",
};

export const ACTION_LABELS: Record<string, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  propose: "Propose",
  approve: "Approve",
  revoke: "Revoke",
  upload: "Upload",
};

/** Domain grouping for the matrix — keeps 15 resources scannable. */
export const RESOURCE_GROUPS: { label: string; resources: string[] }[] = [
  { label: "Sales & CRM", resources: ["deals", "job_sources", "contacts", "companies"] },
  { label: "Inventory", resources: ["products", "warehouses", "containers", "transfers"] },
  { label: "People", resources: ["users", "roles", "technicians"] },
  { label: "Field & billing", resources: ["job_types", "service_areas", "commission", "documents"] },
  { label: "Platform", resources: ["reports", "settings"] },
];

/** The four standard CRUD actions most resources share (drives aligned columns). */
export const STANDARD_ACTIONS = ["view", "create", "edit", "delete"] as const;

export function resourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? resource;
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** True when a resource uses exactly the standard view/create/edit/delete set. */
export function isStandardResource(actions: readonly string[]): boolean {
  return (
    actions.length === STANDARD_ACTIONS.length &&
    STANDARD_ACTIONS.every((a) => actions.includes(a))
  );
}

/** Order a schema's resources by their group, then registry order. */
export function groupedResources(
  schema: Schema,
): { label: string; resources: string[] }[] {
  const known = new Set(Object.keys(schema));
  const out = RESOURCE_GROUPS.map((g) => ({
    label: g.label,
    resources: g.resources.filter((r) => known.has(r)),
  })).filter((g) => g.resources.length > 0);
  // Any resource not in a predefined group falls into "Other".
  const placed = new Set(out.flatMap((g) => g.resources));
  const rest = Object.keys(schema).filter((r) => !placed.has(r));
  if (rest.length) out.push({ label: "Other", resources: rest });
  return out;
}

/* ------------------------------------------------------------------ *
 * Permission matrix (deny-by-default, immutable updates)
 * ------------------------------------------------------------------ */

export function isAllowed(
  permissions: PermissionMatrix,
  resource: string,
  action: string,
): boolean {
  return permissions?.[resource]?.[action] ?? false;
}

export function setAllowed(
  permissions: PermissionMatrix,
  resource: string,
  action: string,
  value: boolean,
): PermissionMatrix {
  return {
    ...permissions,
    [resource]: { ...(permissions[resource] ?? {}), [action]: value },
  };
}

export type RowPreset = "none" | "view" | "full";

export function applyRowPreset(
  permissions: PermissionMatrix,
  resource: string,
  actions: readonly string[],
  preset: RowPreset,
): PermissionMatrix {
  const row: Record<string, boolean> = {};
  for (const action of actions) {
    row[action] =
      preset === "full" || (preset === "view" && action === "view");
  }
  return { ...permissions, [resource]: row };
}

/** Set one action across every resource that supports it. */
export function setColumn(
  permissions: PermissionMatrix,
  schema: Schema,
  action: string,
  value: boolean,
): PermissionMatrix {
  let out = permissions;
  for (const [resource, actions] of Object.entries(schema)) {
    if (actions.includes(action)) out = setAllowed(out, resource, action, value);
  }
  return out;
}

/** Deny everything across the whole schema. */
export function clearMatrix(schema: Schema): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const [resource, actions] of Object.entries(schema)) {
    out[resource] = {};
    for (const action of actions) out[resource][action] = false;
  }
  return out;
}

/** A full matrix with every valid cell present as an explicit boolean. */
export function normalizeMatrix(
  permissions: PermissionMatrix,
  schema: Schema,
): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const [resource, actions] of Object.entries(schema)) {
    out[resource] = {};
    for (const action of actions) {
      out[resource][action] = isAllowed(permissions, resource, action);
    }
  }
  return out;
}

export function countGrants(permissions: PermissionMatrix, schema: Schema): number {
  let n = 0;
  for (const [resource, actions] of Object.entries(schema)) {
    for (const action of actions) if (isAllowed(permissions, resource, action)) n++;
  }
  return n;
}

export function diffCells(
  a: PermissionMatrix,
  b: PermissionMatrix,
  schema: Schema,
): number {
  let n = 0;
  for (const [resource, actions] of Object.entries(schema)) {
    for (const action of actions) {
      if (isAllowed(a, resource, action) !== isAllowed(b, resource, action)) n++;
    }
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * Data scope
 * ------------------------------------------------------------------ */

export const SCOPE_LABELS: Record<DataScope, string> = {
  [DataScope.ALL]: "All data",
  [DataScope.DEPARTMENT]: "Department",
  [DataScope.ASSIGNED_ONLY]: "Assigned-only",
};

export function scopeLabel(scope: DataScope): string {
  return SCOPE_LABELS[scope] ?? scope;
}

/** The most frequent scope across resources — used as the list's summary. */
export function dominantScope(dataScope: DataScopeRules): DataScope {
  const counts = new Map<DataScope, number>();
  for (const scope of Object.values(dataScope)) {
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  let best: DataScope = DataScope.ALL;
  let bestN = -1;
  for (const [scope, n] of counts) {
    if (n > bestN) {
      best = scope;
      bestN = n;
    }
  }
  return best;
}

export function setScope(
  dataScope: DataScopeRules,
  resource: string,
  scope: DataScope,
): DataScopeRules {
  return { ...dataScope, [resource]: scope };
}

export function setAllScopes(
  resources: string[],
  scope: DataScope,
): DataScopeRules {
  const out: DataScopeRules = {};
  for (const r of resources) out[r] = scope;
  return out;
}

/* ------------------------------------------------------------------ *
 * Priority / hierarchy
 * ------------------------------------------------------------------ */

export function sortRolesByPriority<T extends { priority: number }>(roles: T[]): T[] {
  return [...roles].sort((a, b) => b.priority - a.priority);
}

/**
 * A priority strictly between two neighbors (higher `above`, lower `below`).
 * When the gap is too small to fit a distinct integer, returns the midpoint
 * clamped into range (may equal a neighbor in the degenerate adjacent case).
 */
export function priorityBetween(above = 100, below = 0): number {
  const mid = Math.floor((above + below) / 2);
  return Math.min(above - 1, Math.max(below + 1, mid));
}

/* ------------------------------------------------------------------ *
 * Deal-stage transitions ("from->to", with `*` wildcards)
 * ------------------------------------------------------------------ */

const SEP = "->";
const WILD = "*";

/** Stages a role may move a deal *from* (terminal stages have no outgoing move). */
export const SOURCE_STAGES: DealStage[] = Object.values(DealStage).filter(
  (s) => !TERMINAL_STAGES.has(s),
);

/** Stages a role may move a deal *to* (includes terminal stages). */
export const TARGET_STAGES: DealStage[] = Object.values(DealStage);

export const STAGE_LABELS: Record<DealStage, string> = {
  [DealStage.NEW_LEAD]: "New lead",
  [DealStage.ESTIMATE_SENT]: "Estimate sent",
  [DealStage.APPROVED]: "Approved",
  [DealStage.ASSIGNED]: "Assigned",
  [DealStage.EN_ROUTE]: "En route",
  [DealStage.ON_SITE]: "On site",
  [DealStage.WORK_IN_PROGRESS]: "Work in progress",
  [DealStage.PENDING_PAYMENT]: "Pending payment",
  [DealStage.PENDING_PARTS]: "Pending parts",
  [DealStage.FOLLOW_UP]: "Follow up",
  [DealStage.ON_HOLD]: "On hold",
  [DealStage.COMPLETED]: "Completed",
  [DealStage.CANCELED]: "Canceled",
};

export const STAGE_GROUP_LABELS: Record<DealStageGroup, string> = {
  [DealStageGroup.SUBMITTED]: "Submitted",
  [DealStageGroup.IN_PROGRESS]: "In progress",
  [DealStageGroup.PENDING]: "Pending",
  [DealStageGroup.CLOSED]: "Closed",
};

export function stageLabel(stage: DealStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function stageGroupLabel(stage: DealStage): string {
  return STAGE_GROUP_LABELS[STAGE_GROUPS[stage]] ?? "";
}

function rule(from: string, to: string): string {
  return `${from}${SEP}${to}`;
}

export function hasExactTransition(
  transitions: string[],
  from: DealStage,
  to: DealStage,
): boolean {
  return transitions.includes(rule(from, to));
}

export function hasWildcardTo(transitions: string[], to: DealStage): boolean {
  return transitions.includes(rule(WILD, to));
}

export function hasAllTransitions(transitions: string[]): boolean {
  return transitions.includes(rule(WILD, WILD));
}

/** Effective allow check, honoring `*->to` and `*->*` wildcards. */
export function isTransitionAllowed(
  transitions: string[],
  from: DealStage,
  to: DealStage,
): boolean {
  return (
    hasAllTransitions(transitions) ||
    hasWildcardTo(transitions, to) ||
    hasExactTransition(transitions, from, to)
  );
}

function toggleRule(transitions: string[], value: string): string[] {
  return transitions.includes(value)
    ? transitions.filter((t) => t !== value)
    : [...transitions, value];
}

export function toggleTransition(
  transitions: string[],
  from: DealStage,
  to: DealStage,
): string[] {
  return toggleRule(transitions, rule(from, to));
}

export function toggleWildcardTo(transitions: string[], to: DealStage): string[] {
  return toggleRule(transitions, rule(WILD, to));
}

export function toggleAllTransitions(transitions: string[]): string[] {
  return toggleRule(transitions, rule(WILD, WILD));
}

/** Target stages currently covered by a `*->to` wildcard. */
export function wildcardTargets(transitions: string[]): DealStage[] {
  return TARGET_STAGES.filter((to) => hasWildcardTo(transitions, to));
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

/** Whether a role is the immutable Super Admin. */
export function isSuperAdmin(role: Pick<Role, "isSystem" | "name">): boolean {
  return role.isSystem && role.name === "Super Admin";
}

/** A stable accent color for a role's swatch, derived from its id. */
const SWATCH_COLORS = [
  "#7c3aed",
  "#2563eb",
  "#0891b2",
  "#0d9488",
  "#ca8a04",
  "#16a34a",
  "#db2777",
  "#dc2626",
];

export function roleSwatch(roleId: string): string {
  let h = 0;
  for (let i = 0; i < roleId.length; i++) h = (h * 31 + roleId.charCodeAt(i)) >>> 0;
  return SWATCH_COLORS[h % SWATCH_COLORS.length];
}
