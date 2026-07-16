"use client";

import { MoreHorizontal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PermissionMatrix } from "@bitcrm/types";
import {
  actionLabel,
  applyRowPreset,
  groupedResources,
  isAllowed,
  isStandardResource,
  resourceLabel,
  setAllowed,
  setColumn,
  STANDARD_ACTIONS,
  type Schema,
} from "../lib";

export function PermissionMatrixEditor({
  schema,
  permissions,
  baseline,
  readOnly,
  onChange,
}: {
  schema: Schema;
  permissions: PermissionMatrix;
  /** The saved matrix — cells that differ get a "modified" marker. */
  baseline?: PermissionMatrix;
  readOnly?: boolean;
  onChange: (next: PermissionMatrix) => void;
}) {
  const groups = groupedResources(schema);

  const toggleCell = (resource: string, action: string) =>
    onChange(setAllowed(permissions, resource, action, !isAllowed(permissions, resource, action)));

  const columnAllOn = (action: string) =>
    Object.entries(schema)
      .filter(([, actions]) => actions.includes(action))
      .every(([resource]) => isAllowed(permissions, resource, action));

  const toggleColumn = (action: string) =>
    onChange(setColumn(permissions, schema, action, !columnAllOn(action)));

  const modified = (resource: string, action: string) =>
    baseline !== undefined &&
    isAllowed(permissions, resource, action) !== isAllowed(baseline, resource, action);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th className="w-[38%] px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Resource
            </th>
            {STANDARD_ACTIONS.map((action) => (
              <th key={action} className="px-2 py-2 text-center">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => toggleColumn(action)}
                  className="mx-auto flex flex-col items-center gap-0.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase disabled:cursor-not-allowed enabled:hover:text-foreground"
                >
                  {actionLabel(action)}
                  {!readOnly ? (
                    <span className="text-[10px] font-medium text-brand normal-case">
                      {columnAllOn(action) ? "none" : "all"}
                    </span>
                  ) : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <RowGroup
              key={group.label}
              label={group.label}
              resources={group.resources}
              schema={schema}
              permissions={permissions}
              readOnly={readOnly}
              onToggle={toggleCell}
              onPreset={(resource, preset) =>
                onChange(applyRowPreset(permissions, resource, schema[resource], preset))
              }
              modified={modified}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowGroup({
  label,
  resources,
  schema,
  permissions,
  readOnly,
  onToggle,
  onPreset,
  modified,
}: {
  label: string;
  resources: string[];
  schema: Schema;
  permissions: PermissionMatrix;
  readOnly?: boolean;
  onToggle: (resource: string, action: string) => void;
  onPreset: (resource: string, preset: "none" | "view" | "full") => void;
  modified: (resource: string, action: string) => boolean;
}) {
  return (
    <>
      <tr>
        <td
          colSpan={STANDARD_ACTIONS.length + 1}
          className="border-b bg-muted/40 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
        >
          {label}
        </td>
      </tr>
      {resources.map((resource) => {
        const actions = schema[resource];
        const standard = isStandardResource(actions);
        return (
          <tr key={resource} className="border-b last:border-0 hover:bg-muted/30">
            <td className="px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">{resourceLabel(resource)}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {resource}
                </code>
                {!readOnly ? (
                  <span className="ml-auto">
                    <RowPresetMenu resource={resource} onPreset={onPreset} />
                  </span>
                ) : null}
              </div>
            </td>

            {standard ? (
              <>
                {STANDARD_ACTIONS.map((action) => (
                  <td key={action} className="px-2 py-2.5 text-center">
                    <Cell
                      on={isAllowed(permissions, resource, action)}
                      modified={modified(resource, action)}
                      readOnly={readOnly}
                      onToggle={() => onToggle(resource, action)}
                      label={`${resourceLabel(resource)} ${actionLabel(action)}`}
                    />
                  </td>
                ))}
              </>
            ) : (
              <td colSpan={STANDARD_ACTIONS.length} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {actions.map((action) => (
                    <label
                      key={action}
                      className="inline-flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <Cell
                        on={isAllowed(permissions, resource, action)}
                        modified={modified(resource, action)}
                        readOnly={readOnly}
                        onToggle={() => onToggle(resource, action)}
                        label={`${resourceLabel(resource)} ${actionLabel(action)}`}
                      />
                      {actionLabel(action)}
                    </label>
                  ))}
                </div>
              </td>
            )}
          </tr>
        );
      })}
    </>
  );
}

function Cell({
  on,
  modified,
  readOnly,
  onToggle,
  label,
}: {
  on: boolean;
  modified: boolean;
  readOnly?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <span className="relative inline-flex">
      <Switch
        checked={on}
        disabled={readOnly}
        onCheckedChange={onToggle}
        aria-label={label}
      />
      {modified ? (
        <span
          className="absolute -top-1 -right-1 size-1.5 rounded-full bg-brand"
          title="Changed"
        />
      ) : null}
    </span>
  );
}

/** Per-row preset menu, used from the editor toolbar / row affordance. */
export function RowPresetMenu({
  resource,
  onPreset,
  disabled,
}: {
  resource: string;
  onPreset: (resource: string, preset: "none" | "view" | "full") => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" disabled={disabled}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuLabel>{resourceLabel(resource)}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onPreset(resource, "full")}>
          Full access
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPreset(resource, "view")}>
          View only
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onPreset(resource, "none")}>
          No access
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
