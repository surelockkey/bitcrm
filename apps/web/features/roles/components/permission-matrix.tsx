"use client";

import { Fragment } from "react";
import { Ban, Eye, ShieldCheck } from "lucide-react";
import { WzDotsMenu } from "@/components/workiz/dots-menu";
import { WzPopMenu } from "@/components/workiz/pop-menu";
import { WzSwitchRow } from "@/components/workiz/switch-row";
import { WzSwitch } from "@/components/workiz/toggles";
import type { PermissionMatrix } from "@bitcrm/types";
import {
  actionLabel,
  applyRowPreset,
  isAllowed,
  resourceLabel,
  setAllowed,
  setColumn,
  STANDARD_ACTIONS,
  type Schema,
} from "../lib";
import { actionSections, isShownPermission, permissionMatches, permissionWords, reportRows } from "../permission-catalog";

/** Which of Workiz's tabs the list draws. */
export type PermissionSection = "actions" | "reports";

/**
 * The permission list of the role editor and a user's overrides, as Workiz's
 * "Edit permissions for role …" lists its (pg_admin_users_wz_10_role_dispatch):
 * ONE green 40×20 switch per row (Workiz's toggleSwitch-module, `WzSwitch` —
 * #50d58c on, #bbbbbb off, measured off the capture), the bold title and the
 * sentence at the left; Search narrows the rows and finds nothing silently.
 *
 * Ours as well: a small caption per section (Jobs & clients, Billing, …) and
 * per resource, whose ••• sets the resource to Full access / View only / No
 * access; a blue dot on a switch that differs from the saved one. Switches
 * nothing reads (`UNUSED_PERMISSIONS`) are not offered.
 */
export function PermissionMatrixEditor({
  schema,
  permissions,
  baseline,
  readOnly,
  onChange,
  section = "actions",
  query = "",
}: {
  schema: Schema;
  permissions: PermissionMatrix;
  /** The saved matrix — switches that differ get a "changed" dot. */
  baseline?: PermissionMatrix;
  readOnly?: boolean;
  onChange: (next: PermissionMatrix) => void;
  section?: PermissionSection;
  /** Search's words. */
  query?: string;
}) {
  const toggle = (resource: string, action: string) =>
    onChange(setAllowed(permissions, resource, action, !isAllowed(permissions, resource, action)));

  const row = (resource: string, action: string) => {
    const words = permissionWords(resource, action);
    const changed = baseline !== undefined && isAllowed(permissions, resource, action) !== isAllowed(baseline, resource, action);
    return (
      <WzSwitchRow key={`${resource}.${action}`} title={words.title} description={words.description}>
        <span className="relative inline-flex">
          <WzSwitch
            aria-label={`${resourceLabel(resource)} ${actionLabel(action, resource)}`}
            checked={isAllowed(permissions, resource, action)}
            disabled={readOnly}
            onCheckedChange={() => toggle(resource, action)}
          />
          {changed ? <span aria-hidden title="Changed" className="absolute -top-1 -right-1 size-1.5 rounded-full bg-wz-link" /> : null}
        </span>
      </WzSwitchRow>
    );
  };

  if (section === "reports") {
    return (
      <div data-slot="permission-list">
        {reportRows(schema)
          .filter((r) => permissionMatches(r.resource, query, r.action))
          .map((r) => row(r.resource, r.action))}
      </div>
    );
  }

  const sections = actionSections(schema)
    .map((s) => ({
      ...s,
      resources: s.resources
        .map((r) => ({ ...r, actions: r.actions.filter((a) => permissionMatches(r.resource, query, a)) }))
        .filter((r) => r.actions.length > 0),
    }))
    .filter((s) => s.resources.length > 0);

  return (
    <div data-slot="permission-list">
      {sections.map((s) => (
        <Fragment key={s.label}>
          <h6 className="mt-2 mb-3 text-[11px] leading-4 font-medium tracking-[0.6px] text-wz-caption uppercase">{s.label}</h6>
          {s.resources.map(({ resource, actions }) => (
            <Fragment key={resource}>
              <div className="mb-4 flex h-5 items-center justify-between">
                <span className="text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-wz-slate">{resourceLabel(resource)}</span>
                {!readOnly ? (
                  <WzDotsMenu
                    aria-label={`Set ${resourceLabel(resource)}`}
                    items={[
                      { key: "full", label: "Full access", icon: <ShieldCheck />, onSelect: () => onChange(preset(permissions, schema, resource, "full")) },
                      { key: "view", label: "View only", icon: <Eye />, onSelect: () => onChange(preset(permissions, schema, resource, "view")) },
                      { key: "none", label: "No access", icon: <Ban />, onSelect: () => onChange(preset(permissions, schema, resource, "none")) },
                    ]}
                  />
                ) : null}
              </div>
              {actions.map((action) => row(resource, action))}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A resource set to Full access / View only / No access — its shown switches
 * only; one the editor does not offer keeps its stored value.
 */
export function preset(
  permissions: PermissionMatrix,
  schema: Schema,
  resource: string,
  to: "full" | "view" | "none",
): PermissionMatrix {
  const shown = (schema[resource] ?? []).filter((a) => isShownPermission(resource, a));
  const row = applyRowPreset({}, resource, shown, to)[resource];
  return { ...permissions, [resource]: { ...(permissions[resource] ?? {}), ...row } };
}

/**
 * Ours, on Search's line: switch one of View / Create / Edit / Delete on — or
 * off, when it is already on everywhere — for every resource of the Actions
 * tab at once (the old matrix's column heads), in Workiz's "Actions ⌄" menu.
 */
export function SwitchAllMenu({
  schema,
  permissions,
  onChange,
}: {
  schema: Schema;
  permissions: PermissionMatrix;
  onChange: (next: PermissionMatrix) => void;
}) {
  // Only the switches the tab shows: a hidden one keeps its stored value.
  const actionsTab = Object.fromEntries(
    actionSections(schema).flatMap((s) => s.resources.map((r) => [r.resource, r.actions] as const)),
  );
  const allOn = (action: string) =>
    Object.entries(actionsTab)
      .filter(([, actions]) => actions.includes(action))
      .every(([resource]) => isAllowed(permissions, resource, action));
  return (
    <WzPopMenu
      label="Switch all"
      items={STANDARD_ACTIONS.map((action) => ({
        key: action,
        label: `${allOn(action) ? "Switch off" : "Switch on"} ${actionLabel(action)} everywhere`,
        onSelect: () => onChange(setColumn(permissions, actionsTab, action, !allOn(action))),
      }))}
    />
  );
}
