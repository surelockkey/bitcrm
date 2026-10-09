"use client";

import { Fragment } from "react";
import { DataScope } from "@bitcrm/types";
import type { DataScopeRules } from "@bitcrm/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { groupedResources, resourceLabel, scopeLabel, setAllScopes, setScope, type Schema } from "../lib";

const SCOPES = [DataScope.ALL, DataScope.DEPARTMENT, DataScope.ASSIGNED_ONLY];
const SCOPE_OPTIONS = SCOPES.map((s) => ({ value: s, label: scopeLabel(s) }));

/**
 * Which records each permission reaches — the role's data scope, drawn in
 * the shape of Workiz's Advanced rules (pg_admin_users_wz_13_tab_advanced),
 * whose control is a react-select (1px #ccc, 4px corners, a separator and a
 * #ccc chevron — our `Select`). Workiz picks areas / users / statuses in
 * multi-selects; ours is one choice per resource (All data / Department /
 * Assigned-only): a "Set every area to" box, then per section a row per
 * resource — its name and its select — ruled #ddd, two columns. A blue dot
 * marks a scope that differs from the saved one.
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
        <div className="mb-6 flex items-center gap-3">
          <span className="text-sm leading-4 tracking-[0.4px] text-wz-strong">Set every area to</span>
          <Select value="" onValueChange={(v) => onChange({ ...dataScope, ...setAllScopes(allResources, v as DataScope) })}>
            <SelectTrigger aria-label="Set every area to" className="h-10 w-[220px]">
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {SCOPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
                  <Select
                    value={dataScope[resource] ?? DataScope.ALL}
                    disabled={readOnly}
                    onValueChange={(v) => onChange(setScope(dataScope, resource, v as DataScope))}
                  >
                    <SelectTrigger aria-label={`${resourceLabel(resource)} scope`} className="h-10 w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCOPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
