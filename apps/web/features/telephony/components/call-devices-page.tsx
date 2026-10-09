"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
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
import { formatPhone } from "@/lib/phone";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import type { CallDevice } from "@bitcrm/types";
import { useCallDevices, useDeleteCallDevice } from "../call-devices-hooks";
import { CallDeviceEditor, DEVICE_TYPE_LABEL } from "./call-device-editor";

const DEVICES_INTRO =
  "Devices are the desk phones and shop lines your call groups and call flows can ring beside your team's softphones.";

/** The empty grid, in the Call groups tab's words and look (14px/21px 600 over 14px/21px, ink). */
const EMPTY = (
  <div className="text-sm leading-[21px] tracking-[0.4px] text-foreground">
    <p className="font-semibold">No devices added</p>
    <p className="mt-2">Add the desk phones and shop lines your groups and flows should ring</p>
  </div>
);

/** What a device rings on, as people write it: the number, else its SIP address. */
const ringsOn = (d: CallDevice) => (d.number ? formatPhone(d.number) || d.number : (d.sipAddress ?? ""));

/**
 * Workiz Phone → Devices (`/calls/devices`; Settings → Devices lands here as
 * Workiz's tile opens /root/callsReport/devices). Workiz's grid was never
 * captured — the tab stayed on "Loading", its read is gated — so the page is
 * the Call groups tab's pattern (pg_settings_phone_wz_groups): the words and
 * the big yellow pill, the strip, the grid Name | Number | Type | Actions
 * (pencil, bin, centred in a 350px column). A paused device is tagged beside
 * its name.
 */
export function CallDevicesPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const denied = useDenied();
  const devicesQuery = useCallDevices(can("settings"));
  const { data: devices } = devicesQuery;
  const ready = usePageReady(!permissionsLoading && settled(devicesQuery));
  const remove = useDeleteCallDevice();

  const [editing, setEditing] = useState<CallDevice | undefined>();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CallDevice | undefined>();

  const canManage = can("settings", "edit");

  const columns = useMemo<WzGridColumn<CallDevice>[]>(
    () => [
      {
        id: "name",
        label: "Name",
        width: 400,
        sortValue: (d) => d.name,
        searchText: (d) => d.name,
        render: (d) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{d.name}</span>
            {!d.active ? <WzTag className="bg-wz-outline text-[11px] leading-[14px]">Paused</WzTag> : null}
          </span>
        ),
      },
      {
        id: "number",
        label: "Number",
        sortValue: (d) => ringsOn(d),
        searchText: (d) => `${ringsOn(d)} ${d.number ?? ""}`,
        render: (d) => <span className="block truncate">{ringsOn(d)}</span>,
      },
      {
        id: "type",
        label: "Type",
        width: 200,
        sortValue: (d) => DEVICE_TYPE_LABEL[d.type] ?? d.type,
        searchText: (d) => DEVICE_TYPE_LABEL[d.type] ?? d.type,
        render: (d) => DEVICE_TYPE_LABEL[d.type] ?? d.type,
      },
      {
        id: "actions",
        label: "Actions",
        width: 350,
        render: (d) =>
          canManage ? (
            <span className="flex items-center justify-center gap-5">
              <WzRowIconButton label={`Edit ${d.name}`} onClick={() => setEditing(d)}>
                <WzEditIcon size={18} />
              </WzRowIconButton>
              <WzRowIconButton label={`Delete ${d.name}`} onClick={() => setDeleting(d)}>
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
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view devices.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WzTabIntro
        action={
          ready && canManage ? (
            <WzButton className="px-8" icon={<Plus strokeWidth={1.5} />} onClick={() => setCreating(true)}>
              Add device
            </WzButton>
          ) : null
        }
      >
        {DEVICES_INTRO}
      </WzTabIntro>

      {!ready ? (
        <div className="px-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <WzLocalGrid<CallDevice>
          label="Devices"
          columns={columns}
          rows={devices ?? []}
          rowKey={(d) => d.id}
          pagerInside
          emptyText={EMPTY}
        />
      )}

      {creating ? <CallDeviceEditor open onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <CallDeviceEditor
          // Remount per device so the draft starts from that device's values.
          key={editing.id}
          device={editing}
          open
          onClose={() => setEditing(undefined)}
        />
      ) : null}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Call groups and call flows that ring it stop ringing it. The phone line itself is not touched.
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
