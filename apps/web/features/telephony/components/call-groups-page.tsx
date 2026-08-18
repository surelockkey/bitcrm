"use client";

import { useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import type { CallGroupWithMembers } from "@bitcrm/types";
import { useCallGroups, useDeleteCallGroup } from "../call-groups-hooks";
import { CallGroupEditor } from "./call-group-editor";

/**
 * Settings → Call Groups.
 *
 * A group is who an inbound call should reach. Today every call rings every
 * softphone that happens to be open; a group narrows that to a list of people,
 * each reachable on their softphone, their own phone, or both.
 */
export function CallGroupsPage() {
  const { can } = usePermissions();
  const { data: groups, isLoading } = useCallGroups(can("settings"));
  const remove = useDeleteCallGroup();

  const [editing, setEditing] = useState<CallGroupWithMembers | undefined>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CallGroupWithMembers | undefined>();

  const canManage = can("settings", "edit");

  if (!can("settings")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view call groups.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Call groups</h2>
          <p className="text-sm text-muted-foreground">
            Who an incoming call should reach — on their softphone, their own
            phone, or both.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" /> New group
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !groups || groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Users className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No call groups yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Right now every incoming call rings everyone with the phone switched
            on. A group is a shorter list — the dispatchers, the on-call tech —
            and can reach people on their own number when they&apos;re away from
            a desk.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => (
            <li
              key={group.id}
              className={cn(
                "rounded-lg border p-3",
                !group.active && "bg-muted/40",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-sm font-medium">{group.name}</span>
                <span className="rounded border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
                  {group.type === "ring_all" ? "ring all" : "in order"}
                </span>
                {group.active ? (
                  <span className="rounded-full border border-emerald-500/40 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-500">
                    active
                  </span>
                ) : (
                  <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">
                    paused
                  </span>
                )}

                <span className="flex-1" />

                {canManage ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setEditing(group)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${group.name}`}
                      onClick={() => setDeleting(group)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                ) : null}
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                {group.members.length === 0
                  ? "No members yet"
                  : `${group.members.length} member${group.members.length > 1 ? "s" : ""} · ${group.members
                      .map((m) => m.name ?? "Former teammate")
                      .join(", ")}`}
              </p>
              {group.description ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {group.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <CallGroupEditor open onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <CallGroupEditor
          // Remount per group so the draft starts from that group's values.
          key={editing.id}
          group={editing}
          open
          onClose={() => setEditing(undefined)}
        />
      ) : null}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The group and its membership are removed. Nobody&apos;s account or
              phone number is touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) remove.mutate(deleting.id);
                setDeleting(undefined);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
