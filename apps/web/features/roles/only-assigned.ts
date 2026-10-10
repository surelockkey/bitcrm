import { DataScope, RESOURCE_REGISTRY } from "@bitcrm/types";
import type { DataScopeRules } from "@bitcrm/types";

/**
 * "Sees only jobs assigned to them" — what is left of the old Advanced tab
 * (owner, 2026-10-10: the ~36 data-scope selects and the job-stage rules
 * were useless; a technician seeing only the jobs they are on is the one rule
 * that does anything).
 *
 * The switch stands for the data scope of exactly the resources whose scope
 * the server reads for job-bound records (workiz-data-parser
 * docs/import/app-parity-2026-10-08/permissions_completeness.md § "Data
 * scope"): the jobs list and reports (deal-service), the job's invoices,
 * estimates and payments (billing), commission, the client inbox and team
 * chat (messaging). `department` reads as `all` for every one of them.
 *
 * Not `containers`: under `assigned_only` a person sees the van User
 * containers gives them, under `all` every van — tying that to a jobs
 * switch would show every van to technicians the day someone lets them see
 * all jobs. Its stored value is left alone, like every other resource's.
 */
export const ONLY_ASSIGNED_RESOURCES = [
  "deals",
  "invoices",
  "estimates",
  "payments",
  "commission",
  "messages",
  "team_chat",
] as const;

export interface OnlyAssignedState {
  /** Every one of them is assigned-only. */
  on: boolean;
  /**
   * When off: the ones that ARE assigned-only (an override written by the
   * Workiz import's "Other Users Jobs" holds jobs only). Empty when on, or
   * when none is.
   */
  partly: string[];
}

/** Where the switch stands for a role's (or a person's effective) data scope. A missing scope is not assigned-only. */
export function onlyAssignedState(dataScope: DataScopeRules): OnlyAssignedState {
  const limited = ONLY_ASSIGNED_RESOURCES.filter((r) => dataScope[r] === DataScope.ASSIGNED_ONLY);
  const on = limited.length === ONLY_ASSIGNED_RESOURCES.length;
  return { on, partly: on ? [] : limited };
}

export function onlyAssignedOf(dataScope: DataScopeRules): boolean {
  return onlyAssignedState(dataScope).on;
}

/**
 * The data scope with the switch turned on or off; every other resource
 * keeps its stored value. Off opens each assigned-only one to what
 * `fallback` (the saved role) had there — a Dispatcher's `department`
 * comes back as it was, so on-then-off changes nothing — or to `all`.
 */
export function withOnlyAssigned(dataScope: DataScopeRules, on: boolean, fallback: DataScopeRules = {}): DataScopeRules {
  const out: DataScopeRules = { ...dataScope };
  for (const r of ONLY_ASSIGNED_RESOURCES) {
    if (on) {
      out[r] = DataScope.ASSIGNED_ONLY;
    } else if (out[r] === undefined || out[r] === DataScope.ASSIGNED_ONLY) {
      const before = fallback[r];
      out[r] = before !== undefined && before !== DataScope.ASSIGNED_ONLY ? before : DataScope.ALL;
    }
  }
  return out;
}

/**
 * The data scope of a role made in Add New Role: the template's, with every
 * registry resource it lacks set to `all`. The server reads a missing scope
 * as assigned-only (`getDataScopeFilter`), so a role sent with gaps would
 * silently see only its own invoices, messages and commission.
 */
export function newRoleScope(template: DataScopeRules = {}): DataScopeRules {
  const out: DataScopeRules = {};
  for (const r of Object.keys(RESOURCE_REGISTRY)) out[r] = template[r] ?? DataScope.ALL;
  return out;
}
