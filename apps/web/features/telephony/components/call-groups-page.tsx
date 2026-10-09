"use client";

import { useMemo, useState } from "react";
import { PhoneCall } from "lucide-react";
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
import { WzButton } from "@/components/workiz/button";
import { WzEditIcon, WzTrashIcon } from "@/components/workiz/icons";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { WzRowIconButton, WzTabIntro, WzTag } from "@/components/workiz/phone-tab-parts";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import type { CallGroupWithMembers } from "@bitcrm/types";
import { useCallGroups, useDeleteCallGroup } from "../call-groups-hooks";
import { groupMembersText } from "../phone-settings";
import { CallGroupEditor } from "./call-group-editor";

const GROUPS_INTRO =
  "Call groups are a great way to forward calls to a multiple users or devices. You can add and remove users or devices in a group and then choose them as a destination using the call flow builder.";

/** Workiz's empty grid (pg_settings_phone_wz_groups_search_empty): 14px/21px 600 over 14px/21px, ink. */
const EMPTY = (
  <div className="text-sm leading-[21px] tracking-[0.4px] text-foreground">
    <p className="font-semibold">No call groups created</p>
    <p className="mt-2">Forward calls to multiple users or devices by creating your first group</p>
  </div>
);

/**
 * Workiz Phone → Call groups (`/calls/groups`; Settings → Call Groups lands
 * here as Workiz's /root/ct_groups does): its words and "Create a group",
 * the strip, the grid Name | Users and devices | Actions (pencil, bin,
 * centred in a 350px column) — pg_settings_phone_wz_groups. Ours, as tags
 * beside the name: "In order" (Workiz's groups only ring all at once) and
 * "Paused". A group rings its members on their softphone, their own phone,
 * or both — the Users and devices cell says which.
 */
export function CallGroupsPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const denied = useDenied();
  const groupsQuery = useCallGroups(can("settings"));
  const { data: groups } = groupsQuery;
  const ready = usePageReady(!permissionsLoading && settled(groupsQuery));
  const remove = useDeleteCallGroup();

  const [editing, setEditing] = useState<CallGroupWithMembers | undefined>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CallGroupWithMembers | undefined>();

  const canManage = can("settings", "edit");

  const columns = useMemo<WzGridColumn<CallGroupWithMembers>[]>(
    () => [
      {
        id: "name",
        label: "Name",
        width: 400,
        sortValue: (g) => g.name,
        searchText: (g) => g.name,
        render: (g) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{g.name}</span>
            {g.type === "in_order" ? <WzTag className="text-[11px] leading-[14px]">In order</WzTag> : null}
            {!g.active ? <WzTag className="bg-wz-outline text-[11px] leading-[14px]">Paused</WzTag> : null}
          </span>
        ),
      },
      {
        id: "members",
        label: "Users and devices",
        searchText: (g) => groupMembersText(g.members, g.deviceMembers),
        render: (g) =>
          g.members.length || g.deviceMembers?.length ? (
            <span className="block truncate">{groupMembersText(g.members, g.deviceMembers)}</span>
          ) : (
            <span className="text-wz-caption">No members yet</span>
          ),
      },
      {
        id: "actions",
        label: "Actions",
        width: 350,
        render: (g) =>
          canManage ? (
            <span className="flex items-center justify-center gap-5">
              <WzRowIconButton label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
                <WzEditIcon size={18} />
              </WzRowIconButton>
              <WzRowIconButton label={`Delete ${g.name}`} onClick={() => setDeleting(g)}>
                <WzTrashIcon size={19} />
              </WzRowIconButton>
            </span>
          ) : null,
      },
    ],
    [canManage],
  );

  // Refused only once the permissions say so — not while they are coming.
  if (denied("settings")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view call groups.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WzTabIntro
        action={
          ready && canManage ? (
            <WzButton className="px-8" icon={<PhoneCall strokeWidth={1.5} />} onClick={() => setCreating(true)}>
              Create a group
            </WzButton>
          ) : null
        }
      >
        {GROUPS_INTRO}
      </WzTabIntro>

      {!ready ? (
        <div className="px-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <WzLocalGrid<CallGroupWithMembers>
          label="Call groups"
          columns={columns}
          rows={groups ?? []}
          rowKey={(g) => g.id}
          pagerInside
          emptyText={EMPTY}
        />
      )}

      {creating ? <CallGroupEditor open onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <CallGroupEditor
          // Remount per group so the draft starts from that group's values.
          key={editing.id}
          group={editing}
          open
          onClose={() => setEditing(undefined)}
        />
      ) : null}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The group and its membership are removed. Nobody&apos;s account or phone number is touched.
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
