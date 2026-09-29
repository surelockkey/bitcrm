"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoles, useUpdateRole } from "@/features/roles/hooks";
import { audienceRows, changedRoles, grantPatch } from "../widget-audience";

/**
 * "Who can see this widget" — the account-level answer, not a personal one.
 *
 * It edits the same permission matrix the roles screen does, because that is
 * what the server enforces: unticking a role here makes the widget's data
 * endpoint refuse that role, so the card does not merely stop being painted.
 * Saving touches only the roles that moved — each write re-resolves that
 * role's cached permissions for every one of its members.
 */
export function ManageWidgetPermissionsDialog({
  open,
  onOpenChange,
  action,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The action under the `dashboard` resource. */
  action: string;
  /** The widget's name, for the dialog's own copy. */
  label: string;
}) {
  const roles = useRoles(open);
  const update = useUpdateRole();
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const rows = useMemo(
    () => audienceRows(roles.data ?? [], action),
    [roles.data, action],
  );
  const sees = (roleId: string, current: boolean) => picked[roleId] ?? current;
  const pending = changedRoles(roles.data ?? [], action, picked);

  async function save() {
    for (const role of pending) {
      await update.mutateAsync({
        id: role.id,
        body: { permissions: grantPatch(role, action, picked[role.id]) },
      });
    }
    setPicked({});
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setPicked({});
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who can see this widget</DialogTitle>
          <DialogDescription>
            {label} is shown to the roles ticked here. A role without it cannot load the
            widget&apos;s numbers at all.
          </DialogDescription>
        </DialogHeader>

        {roles.isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <ul className="-mx-1 max-h-80 space-y-0.5 overflow-y-auto py-1">
            {rows.map((row) => (
              <li key={row.roleId}>
                <label
                  className={`flex items-start gap-3 rounded-md px-3 py-2 text-sm ${
                    row.locked ? "opacity-60" : "cursor-pointer hover:bg-accent"
                  }`}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={row.locked ? true : sees(row.roleId, row.sees)}
                    disabled={row.locked}
                    onCheckedChange={(v) =>
                      setPicked((p) => ({ ...p, [row.roleId]: v === true }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{row.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {row.locked ? "Always sees every widget" : row.description}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!pending.length || update.isPending}>
            {pending.length ? `Save ${pending.length} change${pending.length > 1 ? "s" : ""}` : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
