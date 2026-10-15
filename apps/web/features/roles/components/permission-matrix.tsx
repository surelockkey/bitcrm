"use client";

import { Fragment, type ReactNode } from "react";
import { Ban, Eye, ShieldCheck } from "lucide-react";
import { WzDotsMenu } from "@/components/workiz/dots-menu";
import { WzPopMenu } from "@/components/workiz/pop-menu";
import { WzSwitchRow } from "@/components/workiz/switch-row";
import { WzSwitch } from "@/components/workiz/toggles";
import type { PermissionMatrix } from "@bitcrm/types";
import { cn } from "@/lib/utils";
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
import { actionSections, isShownPermission, permissionMatches, permissionWords, reportRows, resourceDescription } from "../permission-catalog";

/** Which of Workiz's tabs the list draws. */
export type PermissionSection = "actions" | "reports";

/**
 * A row of ours drawn first in one resource's block of the Actions tab — the
 * jobs block's "Sees only jobs assigned to them". Search keeps it when one of
 * its `words` holds the query, and keeps its block for it.
 */
export interface PermissionLeadRow {
  resource: string;
  words: readonly string[];
  node: ReactNode;
}

/**
 * The permission tree of the role editor and a user's overrides: a small
 * caption per section (Jobs & clients, Billing, …), then ONE row per resource
 * — its title and sentence at the left, every one of its switches at the right
 * with its word (View / Create / Edit / Delete / Change status …) — the owner's
 * "an item and its CRUD switches, as before" (2026-10-15), after a list of one
 * row per action proved far too long to work with. Each switch keeps the
 * action's full Workiz sentence ("Add Jobs — Schedule new jobs") as its
 * tooltip. Workiz's green 40×20 switch (`WzSwitch`).
 *
 * Ours as well: a row's ••• sets the resource to Full access / View only / No
 * access; a blue dot on a switch that differs from the saved one; Search keeps
 * a row with only the switches it finds. Switches nothing reads
 * (`UNUSED_PERMISSIONS`) are not offered. The Reports tab stays a row per
 * report switch.
 */
export function PermissionMatrixEditor({
  schema,
  permissions,
  baseline,
  readOnly,
  onChange,
  section = "actions",
  query = "",
  lead,
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
  /** Actions tab: a row of ours at the top of one resource's block. */
  lead?: PermissionLeadRow;
}) {
  const toggle = (resource: string, action: string) =>
    onChange(setAllowed(permissions, resource, action, !isAllowed(permissions, resource, action)));

  const changed = (resource: string, action: string) =>
    baseline !== undefined && isAllowed(permissions, resource, action) !== isAllowed(baseline, resource, action);

  /**
   * One slot of a resource's row. View / Create / Edit / Delete sit in four
   * fixed columns on every row (`fixed`), so a column reads straight down the
   * page; one the resource lacks, or the editor does not offer, is an empty
   * slot. The resource's own actions (Change status, Propose …) follow.
   */
  const slot = (resource: string, action: string, shown: boolean, fixed: boolean) => (
    <span
      key={action}
      data-slot="permission-slot"
      data-action={action}
      className={cn("inline-flex items-center justify-end", fixed ? "w-[120px]" : "pl-6")}
    >
      {shown ? cell(resource, action) : null}
    </span>
  );

  /** One switch in a resource's row: its word before it, the action's Workiz sentence as the tooltip. */
  const cell = (resource: string, action: string) => {
    const words = permissionWords(resource, action);
    return (
      <span
        title={`${words.title} — ${words.description}`}
        className="inline-flex items-center gap-2 text-[13px] leading-[19px] tracking-[0.4px] whitespace-nowrap text-wz-slate"
      >
        {actionLabel(action, resource)}
        <span className="relative inline-flex">
          <WzSwitch
            aria-label={`${resourceLabel(resource)} ${actionLabel(action, resource)}`}
            checked={isAllowed(permissions, resource, action)}
            disabled={readOnly}
            onCheckedChange={() => toggle(resource, action)}
          />
          {changed(resource, action) ? (
            <span aria-hidden title="Changed" className="absolute -top-1 -right-1 size-1.5 rounded-full bg-wz-link" />
          ) : null}
        </span>
      </span>
    );
  };

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

  const q = query.trim().toLowerCase();
  const shownLead = lead && (!q || lead.words.some((w) => w.toLowerCase().includes(q))) ? lead : undefined;

  const sections = actionSections(schema)
    .map((s) => ({
      ...s,
      resources: s.resources
        .map((r) => ({ ...r, actions: r.actions.filter((a) => permissionMatches(r.resource, query, a)) }))
        .filter((r) => r.actions.length > 0 || r.resource === shownLead?.resource),
    }))
    .filter((s) => s.resources.length > 0);

  return (
    <div data-slot="permission-list">
      {sections.map((s) => (
        <Fragment key={s.label}>
          <h6 className="mt-2 mb-3 text-[11px] leading-4 font-medium tracking-[0.6px] text-wz-caption uppercase">{s.label}</h6>
          {s.resources.map(({ resource, actions }) => (
            <Fragment key={resource}>
              {shownLead?.resource === resource ? shownLead.node : null}
              {actions.length > 0 ? (
                <WzSwitchRow title={resourceLabel(resource)} description={resourceDescription(resource)}>
                  <span data-slot="permission-switches" className="flex flex-wrap items-center gap-y-3 lg:w-[860px]">
                    {/* Search may keep only some switches: then the row is just those, in order. */}
                    {query.trim()
                      ? actions.map((action) => slot(resource, action, true, STANDARD_ACTIONS.includes(action as never)))
                      : [
                          ...STANDARD_ACTIONS.filter((a) => (schema[resource] ?? []).includes(a)).length > 0
                            ? STANDARD_ACTIONS.map((a) => slot(resource, a, actions.includes(a), true))
                            : [],
                          ...actions.filter((a) => !STANDARD_ACTIONS.includes(a as never)).map((a) => slot(resource, a, true, false)),
                        ]}
                  </span>
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
                </WzSwitchRow>
              ) : null}
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
