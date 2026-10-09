"use client";

import { useMemo, useState } from "react";
import { Copy, Plus } from "lucide-react";
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
import { WzButtonLink } from "@/components/workiz/button";
import { WzEditIcon, WzTrashIcon } from "@/components/workiz/icons";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { WzRowIconButton, WzTabIntro, WzTag } from "@/components/workiz/phone-tab-parts";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import type { CallFlow, CallFlowNode } from "@bitcrm/types";
import { useCallGroups } from "../call-groups-hooks";
import { useCallFlows, useDeleteCallFlow, useDuplicateCallFlow } from "../call-flows-hooks";
import { flowNumbersText } from "../phone-settings";

/**
 * A one-line summary, following the main line of the flow — the path a caller
 * takes when nothing branches. Branches are visible in the editor; this is
 * meant to be scannable.
 */
function describe(flow: CallFlow, groupName: (id: string) => string): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = flow.entryNodeId;

  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node: CallFlowNode | undefined = flow.nodes?.[cursor];
    if (!node) break;
    switch (node.type) {
      case "say":
        parts.push(node.audioId ? "recorded greeting" : "greeting");
        break;
      case "hours":
        parts.push("business hours");
        break;
      case "menu":
        parts.push(`menu (${node.options.length} option${node.options.length === 1 ? "" : "s"})`);
        break;
      case "ring":
        parts.push(`ring ${groupName(node.groupId)}`);
        break;
      case "voicemail":
        parts.push("voicemail");
        break;
      case "hangup":
        parts.push("hang up");
        break;
    }
    cursor = node.type === "hours" ? node.openNext : node.next;
  }
  return parts.join(" → ") || "no steps yet";
}

const FLOWS_INTRO =
  "Call flows route your calls to where they need to go. Tailor your call flows to your business needs with custom greetings, menus, and voicemail.";

/**
 * Workiz Phone → Call flows (`/calls/flows`; Settings → Call Flows lands
 * here as Workiz's /root/flows does): its words and "+ Create Call Flow",
 * the strip, the grid Name | Numbers | Actions — the edit icon opens the
 * builder (`/calls/flows/<id>`, Workiz's /root/flowBuilder/<id>), the bin,
 * the copy (pg_settings_phone_wz_flows). Ours: the Steps column (the path a
 * caller takes, in order) and a Paused tag beside the name. Workiz's
 * "Use smart callback" and its Fallback Number row have no counterpart here.
 *
 * A flow is what happens between a customer dialling and somebody's phone
 * ringing. Without one a number rings every softphone that happens to be
 * online, which is what every number did before this existed.
 */
export function CallFlowsPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const denied = useDenied();
  const flowsQuery = useCallFlows(can("settings"));
  const groupsQuery = useCallGroups(can("settings"));
  const { data: flows } = flowsQuery;
  const { data: groups } = groupsQuery;
  // The flows wait for the groups they ring: drawn first, every summary said
  // "ring a deleted group" until the names came and rewrote it.
  const ready = usePageReady(!permissionsLoading && settled(flowsQuery) && settled(groupsQuery));
  const remove = useDeleteCallFlow();
  const duplicate = useDuplicateCallFlow();

  const [deleting, setDeleting] = useState<CallFlow | undefined>();

  const canManage = can("settings", "edit");

  const columns = useMemo<WzGridColumn<CallFlow>[]>(() => {
    const groupName = (id: string) => (groups ?? []).find((g) => g.id === id)?.name ?? "a deleted group";
    return [
      {
        id: "name",
        label: "Name",
        sortValue: (f) => f.name,
        searchText: (f) => f.name,
        render: (f) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{f.name}</span>
            {!f.active ? <WzTag className="bg-wz-outline text-[11px] leading-[14px]">Paused</WzTag> : null}
          </span>
        ),
      },
      {
        id: "numbers",
        label: "Numbers",
        searchText: (f) => `${flowNumbersText(f.numbers)} ${f.numbers.join(" ")}`,
        render: (f) =>
          f.numbers.length ? (
            <span className="block truncate">{flowNumbersText(f.numbers)}</span>
          ) : (
            <span className="text-wz-caption">No numbers — this flow answers nothing yet</span>
          ),
      },
      {
        // Ours: the path a caller takes when nothing branches.
        id: "steps",
        label: "Steps",
        searchText: (f) => describe(f, groupName),
        render: (f) => <span className="block truncate">{describe(f, groupName)}</span>,
      },
      {
        id: "actions",
        label: "Actions",
        width: 150,
        render: (f) =>
          canManage ? (
            <span className="flex items-center gap-4">
              <WzRowIconButton label={`Edit ${f.name}`} href={`/calls/flows/${f.id}`}>
                <WzEditIcon size={18} />
              </WzRowIconButton>
              <WzRowIconButton label={`Delete ${f.name}`} onClick={() => setDeleting(f)}>
                <WzTrashIcon size={19} />
              </WzRowIconButton>
              <WzRowIconButton label={`Duplicate ${f.name}`} disabled={duplicate.isPending} onClick={() => duplicate.mutate(f)}>
                <Copy className="size-[19px]" strokeWidth={1.5} />
              </WzRowIconButton>
            </span>
          ) : null,
      },
    ];
  }, [groups, canManage, duplicate]);

  // Refused only once the permissions say so — not while they are coming.
  if (denied("settings")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view call flows.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WzTabIntro
        action={
          ready && canManage ? (
            <WzButtonLink href="/calls/flows/new" className="px-8" icon={<Plus strokeWidth={1.5} />}>
              Create Call Flow
            </WzButtonLink>
          ) : null
        }
      >
        {FLOWS_INTRO}
      </WzTabIntro>

      {!ready ? (
        <div className="px-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <WzLocalGrid<CallFlow> label="Call flows" columns={columns} rows={flows ?? []} rowKey={(f) => f.id} pagerInside emptyText={null} />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its numbers go back to ringing everyone who has the phone switched on. No numbers are released and no call
              groups are changed.
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
