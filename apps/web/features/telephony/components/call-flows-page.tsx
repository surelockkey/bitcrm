"use client";

import { useState } from "react";
import { Plus, Trash2, Workflow } from "lucide-react";
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
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/features/auth/use-permissions";
import type { CallFlow, RingNode, SayNode } from "@bitcrm/types";
import { useCallGroups } from "../call-groups-hooks";
import { useCallFlows, useDeleteCallFlow } from "../call-flows-hooks";
import { CallFlowEditor } from "./call-flow-editor";

/** A one-line summary of what this flow actually does. */
function describe(flow: CallFlow, groupName: (id: string) => string): string {
  const nodes = Object.values(flow.nodes ?? {});
  const say = nodes.find((n): n is SayNode => n.type === "say");
  const ring = nodes.find((n): n is RingNode => n.type === "ring");
  const takesMessage = nodes.some((n) => n.type === "voicemail");

  const parts = [
    say ? "greeting" : null,
    ring ? `ring ${groupName(ring.groupId)}` : null,
    takesMessage ? "voicemail" : "hang up",
  ].filter(Boolean);
  return parts.join(" → ");
}

/**
 * Settings → Call Flows.
 *
 * A flow is what happens between a customer dialling and somebody's phone
 * ringing. Without one a number rings every softphone that happens to be
 * online, which is what every number did before this existed.
 */
export function CallFlowsPage() {
  const { can } = usePermissions();
  const { data: flows, isLoading } = useCallFlows(can("settings"));
  const { data: groups } = useCallGroups(can("settings"));
  const remove = useDeleteCallFlow();

  const [editing, setEditing] = useState<CallFlow | undefined>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CallFlow | undefined>();

  const canManage = can("settings", "edit");
  const groupName = (id: string) =>
    (groups ?? []).find((g) => g.id === id)?.name ?? "a deleted group";

  if (!can("settings")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view call flows.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Call flows</h2>
          <p className="text-sm text-muted-foreground">
            What a caller hears, and who gets rung, before anybody picks up.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" /> New flow
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !flows || flows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Workflow className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No call flows yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Every number currently rings whoever has the phone switched on, and
            hangs up when nobody does. A flow adds a greeting, picks which group
            rings, and takes a message instead of losing the call.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {flows.map((flow) => (
            <li
              key={flow.id}
              className={cn("rounded-lg border p-3", !flow.active && "bg-muted/40")}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-sm font-medium">{flow.name}</span>
                {flow.active ? (
                  <span className="rounded-full border border-emerald-500/40 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-500">
                    live
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
                      onClick={() => setEditing(flow)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${flow.name}`}
                      onClick={() => setDeleting(flow)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                ) : null}
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                {describe(flow, groupName)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {flow.numbers.length === 0
                  ? "No numbers — this flow answers nothing yet"
                  : flow.numbers.map(formatPhone).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      )}

      {creating ? <CallFlowEditor open onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <CallFlowEditor
          key={editing.id}
          flow={editing}
          open
          onClose={() => setEditing(undefined)}
        />
      ) : null}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its numbers go back to ringing everyone who has the phone switched
              on. No numbers are released and no call groups are changed.
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
