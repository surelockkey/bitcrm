"use client";

import { Fragment } from "react";
import { Ban, Eye, ShieldCheck } from "lucide-react";
import { WzDotsMenu } from "@/components/workiz/dots-menu";
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
import { actionSections, permissionMatches, reportRows, resourceDescription } from "../permission-catalog";

/** Which of Workiz's tabs the list draws: Actions (a row per resource) or Reports (a row per switch). */
export type PermissionSection = "actions" | "reports";

/**
 * The permission list of the role editor and a user's overrides, as Workiz's
 * "Edit permissions for role …" lists its (pg_admin_users_wz_10_role_dispatch):
 * a row per permission — bold title, the sentence under it, the green switch
 * at the right — that Search narrows, and nothing at all when it finds
 * nothing.
 *
 * Workiz has one switch per row; ours are resource × action, so an Actions
 * row carries each of its resource's switches with its words beside it
 * ("View", "Create", "Take payments"), under a small caption per section
 * (Jobs & clients, Billing, …). The Reports tab is Workiz's: a row per report
 * or dashboard card. Ours as well: the first row switches an action on or off
 * for every resource at once, a row's ••• sets it to Full access / View only
 * / No access, and a blue dot marks a switch that differs from the saved one.
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

  const modified = (resource: string, action: string) =>
    baseline !== undefined && isAllowed(permissions, resource, action) !== isAllowed(baseline, resource, action);

  const cell = (resource: string, action: string, words?: string) => (
    <PermissionSwitch
      key={action}
      words={words}
      label={`${resourceLabel(resource)} ${actionLabel(action, resource)}`}
      on={isAllowed(permissions, resource, action)}
      modified={modified(resource, action)}
      readOnly={readOnly}
      onToggle={() => toggle(resource, action)}
    />
  );

  if (section === "reports") {
    const rows = reportRows(schema).filter((r) => permissionMatches(r.resource, query, r.action));
    return (
      <div data-slot="permission-list">
        {rows.map((r) => (
          <WzSwitchRow key={`${r.resource}.${r.action}`} title={r.title} description={r.description}>
            {cell(r.resource, r.action)}
          </WzSwitchRow>
        ))}
      </div>
    );
  }

  const sections = actionSections(schema)
    .map((s) => ({ ...s, resources: s.resources.filter((r) => permissionMatches(r, query)) }))
    .filter((s) => s.resources.length > 0);
  const actionsOnly = Object.fromEntries(Object.entries(schema).filter(([r]) => sections.some((s) => s.resources.includes(r))));
  const columnAllOn = (action: string) =>
    Object.entries(actionsOnly)
      .filter(([, actions]) => actions.includes(action))
      .every(([resource]) => isAllowed(permissions, resource, action));

  return (
    <div data-slot="permission-list">
      {!readOnly && !query.trim() && sections.length > 0 ? (
        <WzSwitchRow title="Every resource" description="Switch an action on or off for every resource below at once">
          {STANDARD_ACTIONS.map((action) => (
            <PermissionSwitch
              key={action}
              words={actionLabel(action)}
              label={`Every resource ${actionLabel(action)}`}
              on={columnAllOn(action)}
              modified={false}
              onToggle={() => onChange(setColumn(permissions, actionsOnly, action, !columnAllOn(action)))}
            />
          ))}
        </WzSwitchRow>
      ) : null}
      {sections.map((s) => (
        <Fragment key={s.label}>
          <h6 className="mt-2 mb-4 text-[11px] leading-4 font-medium tracking-[0.6px] text-wz-caption uppercase">{s.label}</h6>
          {s.resources.map((resource) => (
            <WzSwitchRow key={resource} title={resourceLabel(resource)} description={resourceDescription(resource)}>
              {schema[resource].map((action) => cell(resource, action, actionLabel(action, resource)))}
              {!readOnly ? (
                <WzDotsMenu
                  aria-label={`Set ${resourceLabel(resource)}`}
                  items={[
                    { key: "full", label: "Full access", icon: <ShieldCheck />, onSelect: () => onChange(applyRowPreset(permissions, resource, schema[resource], "full")) },
                    { key: "view", label: "View only", icon: <Eye />, onSelect: () => onChange(applyRowPreset(permissions, resource, schema[resource], "view")) },
                    { key: "none", label: "No access", icon: <Ban />, onSelect: () => onChange(applyRowPreset(permissions, resource, schema[resource], "none")) },
                  ]}
                />
              ) : null}
            </WzSwitchRow>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * One switch: Workiz's 40×20 green toggle, its words before it (13px slate,
 * as the job page's small labels), and our blue dot when it differs from the
 * saved matrix.
 */
function PermissionSwitch({
  words,
  label,
  on,
  modified,
  readOnly,
  onToggle,
}: {
  words?: string;
  label: string;
  on: boolean;
  modified: boolean;
  readOnly?: boolean;
  onToggle: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] leading-[19px] tracking-[0.4px] whitespace-nowrap text-wz-slate">
      {words}
      <span className="relative inline-flex">
        <WzSwitch aria-label={label} checked={on} disabled={readOnly} onCheckedChange={onToggle} />
        {modified ? (
          <span aria-hidden title="Changed" className="absolute -top-1 -right-1 size-1.5 rounded-full bg-wz-link" />
        ) : null}
      </span>
    </span>
  );
}
