"use client";

import { useMemo, useState } from "react";
import { PhoneOff } from "lucide-react";
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
import { WzTrashIcon } from "@/components/workiz/icons";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { WzRowIconButton, WzTabIntro } from "@/components/workiz/phone-tab-parts";
import { formatPhone } from "@/lib/phone";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import type { BlockedCaller } from "@bitcrm/types";
import { blockedDay } from "../blocked-callers";
import { useBlockedCallers, useUnblockCaller } from "../blocked-callers-hooks";
import { BlockNumberDialog } from "./block-number-dialog";

const INTRO = "Define numbers you wish to block like sales calls and other spam callers.";

/**
 * Workiz Phone → Blocked callers (`/calls/blocked-callers`,
 * settings_audit_wz_blocked_callers_v4): its words and "Block a Number", the
 * empty strip (no Search — unlike the other Phone tabs), the grid Number |
 * Comment | Created | Actions (a red bin: unblock, after a confirmation),
 * oldest first, ten a page with the pager inside the frame. Everything is
 * behind `calls.block`.
 */
export function BlockedCallersPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const denied = useDenied();
  const canBlock = can("calls", "block");
  const query = useBlockedCallers(canBlock);
  const { data: rows } = query;
  const ready = usePageReady(!permissionsLoading && settled(query));
  const unblock = useUnblockCaller();

  const [blocking, setBlocking] = useState(false);
  const [unblocking, setUnblocking] = useState<BlockedCaller | undefined>();

  const columns = useMemo<WzGridColumn<BlockedCaller>[]>(
    () => [
      {
        id: "number",
        label: "Number",
        sortValue: (r) => r.number,
        searchText: (r) => `${r.number} ${formatPhone(r.number)}`,
        render: (r) => formatPhone(r.number) || r.number,
      },
      {
        id: "comment",
        label: "Comment",
        sortValue: (r) => r.comment,
        searchText: (r) => r.comment,
        render: (r) => r.comment ?? "",
      },
      {
        id: "created",
        label: "Created",
        sortValue: (r) => r.createdAt,
        render: (r) => blockedDay(r.createdAt),
      },
      {
        id: "actions",
        label: "Actions",
        // Workiz: 152px, the bin centred (the three others share the rest).
        width: 152,
        // Workiz's rows are 58px (a 16px line in 20px of padding); the 24px
        // icon button sits in a 16px line, overhanging 4px each way, so the
        // row keeps that height instead of growing to 64px.
        render: (r) => (
          <span className="flex h-4 items-center justify-center">
            <WzRowIconButton label={`Unblock ${formatPhone(r.number) || r.number}`} onClick={() => setUnblocking(r)} className="text-wz-danger">
              <WzTrashIcon size={19} />
            </WzRowIconButton>
          </span>
        ),
      },
    ],
    [],
  );

  // Refused only once the permissions say so — not while they are coming.
  if (denied("calls", "block")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view blocked callers.</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WzTabIntro
        action={
          ready ? (
            <WzButton className="px-8" icon={<PhoneOff strokeWidth={1.5} />} onClick={() => setBlocking(true)}>
              Block a Number
            </WzButton>
          ) : null
        }
      >
        {INTRO}
      </WzTabIntro>

      {!ready ? (
        <div className="px-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <WzLocalGrid<BlockedCaller>
          label="Blocked callers"
          columns={columns}
          rows={rows ?? []}
          rowKey={(r) => r.id}
          defaultSort={{ id: "created", dir: "asc" }}
          search={false}
          pagerInside
          // Workiz's rows: a 16px line in 20px of padding plus react-table's
          // hairlines — 58px (settings_audit_wz_blocked_callers_v4).
          rowClassName="h-[58px]"
        />
      )}

      {/* Mounted only while open, so each opening is a fresh form. */}
      {blocking ? <BlockNumberDialog open onOpenChange={setBlocking} /> : null}

      <AlertDialog open={!!unblocking} onOpenChange={(o) => !o && setUnblocking(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unblock {unblocking ? formatPhone(unblocking.number) || unblocking.number : ""}?</AlertDialogTitle>
            <AlertDialogDescription>Calls and texts from this number will reach the office again.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (unblocking) unblock.mutate(unblocking.number);
                setUnblocking(undefined);
              }}
            >
              Unblock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
