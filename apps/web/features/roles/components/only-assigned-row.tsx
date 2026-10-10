"use client";

import type { DataScopeRules } from "@bitcrm/types";
import { WzSwitchRow } from "@/components/workiz/switch-row";
import { WzSwitch } from "@/components/workiz/toggles";
import { resourceLabel } from "../lib";
import { onlyAssignedState, sameOnlyAssigned, withOnlyAssigned } from "../only-assigned";

/** The row's title — also what the person page's summary calls the switch. */
export const ONLY_ASSIGNED_TITLE = "Sees only jobs assigned to them";
const DESCRIPTION =
  "Jobs, their invoices, estimates, payments, commissions and messages: only the ones this person is assigned to.";

/** What Search matches the row by. */
export const ONLY_ASSIGNED_ROW_WORDS = [ONLY_ASSIGNED_TITLE, DESCRIPTION, "Jobs"] as const;

function list(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * "Sees only jobs assigned to them" — the one rule left of the old Advanced
 * tab, at the top of the Actions tab's jobs block, in Workiz's row
 * (`WzSwitchRow`: the bold title, the sentence, the 40×20 green switch).
 * Workiz's own row is the other way round — "Other Users Jobs: Can view
 * everyones jobs, schedule and messages." (pg_admin_users_wz_10_role_dispatch).
 *
 * It reads and writes the data scope of the job-bound resources
 * (`ONLY_ASSIGNED_RESOURCES`); off gives each back what `fallback` (the saved
 * role) had there. When only some of them are assigned-only — an override
 * the Workiz import wrote for "Other Users Jobs" — it is off and says which.
 * A blue dot, as on every row, when it differs from `baseline`.
 */
export function OnlyAssignedRow({
  dataScope,
  baseline,
  fallback,
  readOnly,
  onChange,
}: {
  dataScope: DataScopeRules;
  /** The saved scope (the role's, on a person's page) — a difference gets a "changed" dot. */
  baseline?: DataScopeRules;
  /** What switching off gives back where it is not assigned-only (else all). */
  fallback?: DataScopeRules;
  readOnly?: boolean;
  onChange: (next: DataScopeRules) => void;
}) {
  const state = onlyAssignedState(dataScope);
  const changed = baseline !== undefined && !sameOnlyAssigned(dataScope, baseline);
  const partly = state.partly.map((r) => resourceLabel(r));
  return (
    <WzSwitchRow
      title={ONLY_ASSIGNED_TITLE}
      description={
        <>
          {DESCRIPTION}
          {partly.length > 0 ? (
            <span className="mt-1 block text-wz-outline-label">Partly on now — only for {list(partly)}.</span>
          ) : null}
        </>
      }
    >
      <span className="relative inline-flex">
        <WzSwitch
          aria-label={ONLY_ASSIGNED_TITLE}
          checked={state.on}
          disabled={readOnly}
          onCheckedChange={(on) => onChange(withOnlyAssigned(dataScope, on, fallback))}
        />
        {changed ? <span aria-hidden title="Changed" className="absolute -top-1 -right-1 size-1.5 rounded-full bg-wz-link" /> : null}
      </span>
    </WzSwitchRow>
  );
}
