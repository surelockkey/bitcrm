"use client";

import { DataScope } from "@bitcrm/types";
import type { DataScopeRules } from "@bitcrm/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  groupedResources,
  resourceLabel,
  scopeLabel,
  setAllScopes,
  setScope,
  type Schema,
} from "../lib";

const SCOPES = [DataScope.ALL, DataScope.DEPARTMENT, DataScope.ASSIGNED_ONLY];

export function DataScopeEditor({
  schema,
  dataScope,
  baseline,
  readOnly,
  onChange,
}: {
  schema: Schema;
  dataScope: DataScopeRules;
  /** The saved rules — resources that differ get a "modified" marker. */
  baseline?: DataScopeRules;
  readOnly?: boolean;
  onChange: (next: DataScopeRules) => void;
}) {
  const groups = groupedResources(schema);
  const allResources = Object.keys(schema);

  const modified = (resource: string) =>
    baseline !== undefined &&
    (dataScope[resource] ?? DataScope.ALL) !== (baseline[resource] ?? DataScope.ALL);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
        <div className="text-sm">
          <div className="font-medium">Data visibility</div>
          <div className="text-xs text-muted-foreground">
            Which records each permission applies to.
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Set all to</span>
          <Select
            value=""
            disabled={readOnly}
            onValueChange={(v) => onChange({ ...dataScope, ...setAllScopes(allResources, v as DataScope) })}
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {SCOPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {scopeLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </div>
            <div className="divide-y rounded-lg border">
              {group.resources.map((resource) => (
                <div
                  key={resource}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                >
                  <span className="text-sm">{resourceLabel(resource)}</span>
                  <span className="relative inline-flex">
                    <Select
                      value={dataScope[resource] ?? DataScope.ALL}
                      disabled={readOnly}
                      onValueChange={(v) =>
                        onChange(setScope(dataScope, resource, v as DataScope))
                      }
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCOPES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {scopeLabel(s)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {modified(resource) ? (
                      <span
                        className="absolute -top-1 -right-1 size-1.5 rounded-full bg-brand"
                        title="Changed"
                      />
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
