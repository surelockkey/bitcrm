"use client";

import { Fragment } from "react";
import { DataScope } from "@bitcrm/types";
import type { DataScopeRules } from "@bitcrm/types";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { groupedResources, resourceLabel, scopeLabel, setAllScopes, setScope, type Schema } from "../lib";

const SCOPES = [DataScope.ALL, DataScope.DEPARTMENT, DataScope.ASSIGNED_ONLY];
const SCOPE_OPTIONS = SCOPES.map((s) => ({ value: s, label: scopeLabel(s) }));

/**
 * Which records each permission reaches — the role's data scope, drawn in
 * the shape of Workiz's Advanced rules (pg_admin_users_wz_13_tab_advanced):
 * Workiz's boxes are 714×48 react-selects; ours a "Set every area to" box,
 * then per section (the permission list's captions) a row per resource — its
 * name and a 220px outlined select of All data / Department / Assigned-only,
 * ruled #ddd, two columns. A blue dot marks a scope that differs from the
 * saved one.
 */
export function DataScopeEditor({
  schema,
  dataScope,
  baseline,
  readOnly,
  onChange,
}: {
  schema: Schema;
  dataScope: DataScopeRules;
  /** The saved rules — resources that differ get a "changed" dot. */
  baseline?: DataScopeRules;
  readOnly?: boolean;
  onChange: (next: DataScopeRules) => void;
}) {
  const groups = groupedResources(schema);
  const allResources = Object.keys(schema);

  const modified = (resource: string) =>
    baseline !== undefined && (dataScope[resource] ?? DataScope.ALL) !== (baseline[resource] ?? DataScope.ALL);

  return (
    <div>
      {!readOnly ? (
        <WzOutlinedSelect
          label="Set every area to"
          placeholder="Choose…"
          options={SCOPE_OPTIONS}
          value=""
          onChange={(v) => onChange({ ...dataScope, ...setAllScopes(allResources, v as DataScope) })}
          className="mb-6 w-[350px] max-w-full"
        />
      ) : null}
      <div className="grid max-w-[1462px] gap-x-12 sm:grid-cols-2">
        {groups.map((group) => (
          <Fragment key={group.label}>
            <h6 className="col-span-full mt-4 mb-1 text-[11px] leading-4 font-medium tracking-[0.6px] text-wz-caption uppercase">
              {group.label}
            </h6>
            {group.resources.map((resource) => (
              <div key={resource} className="flex min-h-[57px] items-center justify-between gap-3 border-b border-wz-frame py-2">
                <span className="text-sm leading-4 tracking-[0.4px] text-foreground">{resourceLabel(resource)}</span>
                <span className="relative inline-flex">
                  <WzOutlinedSelect
                    label={`${resourceLabel(resource)} scope`}
                    labelHidden
                    options={SCOPE_OPTIONS}
                    value={dataScope[resource] ?? DataScope.ALL}
                    disabled={readOnly}
                    onChange={(v) => onChange(setScope(dataScope, resource, v as DataScope))}
                    className="w-[220px]"
                  />
                  {modified(resource) ? (
                    <span aria-hidden title="Changed" className="absolute -top-1 -right-1 size-1.5 rounded-full bg-wz-link" />
                  ) : null}
                </span>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
