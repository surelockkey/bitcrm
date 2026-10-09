"use client";

import { useState } from "react";
import { Ban, Eye, MailPlus, Pencil, RotateCcw, ShieldCheck } from "lucide-react";
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
import { WzDotsMenu, type WzDotsMenuItem } from "@/components/workiz/dots-menu";
import type { User } from "@bitcrm/types";
import { UserStatus } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useHierarchy } from "../use-can-manage";
import { useDeactivateUser, useReactivateUser, useResendInvite } from "../hooks";

/**
 * A row's own actions, behind Workiz's ••• (`dotsPopMenu`, the card menu of
 * the Automation Center): View, Edit profile, Change role, Resend invite,
 * then Deactivate (red) or Reactivate. Workiz's Team grid has no such column;
 * ours keeps these one click from the row, in Workiz's menu.
 *
 * Its clicks stay here: a click on the dots or a row of the menu (a portal,
 * but React bubbles through it) must not open the user as a row click would.
 */
export function UserRowActions({
  user,
  name,
  onOpen,
}: {
  user: User;
  /** The name the row prints, for the button's accessible name. */
  name: string;
  onOpen: (u: User, tab?: string) => void;
}) {
  const { can } = usePermissions();
  const { canManage } = useHierarchy();
  const manageable = canManage(user);
  const resend = useResendInvite();
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const [confirm, setConfirm] = useState(false);

  const isActive = user.status === UserStatus.ACTIVE;
  const canEdit = can("users", "edit") && manageable;
  const canDelete = can("users", "delete") && manageable;
  const canReactivate = can("users", "edit") && manageable;

  const items: WzDotsMenuItem[] = [
    { key: "view", label: "View", icon: <Eye />, onSelect: () => onOpen(user, "profile") },
    ...(canEdit
      ? [
          { key: "edit", label: "Edit profile", icon: <Pencil />, onSelect: () => onOpen(user, "profile") },
          { key: "role", label: "Change role", icon: <ShieldCheck />, onSelect: () => onOpen(user, "role") },
        ]
      : []),
    ...(can("users", "create")
      ? [{ key: "resend", label: "Resend invite", icon: <MailPlus />, onSelect: () => resend.mutate(user.id) }]
      : []),
    ...(isActive
      ? canDelete
        ? [{ key: "deactivate", label: "Deactivate", icon: <Ban />, destructive: true, onSelect: () => setConfirm(true) }]
        : []
      : canReactivate
        ? [{ key: "reactivate", label: "Reactivate", icon: <RotateCcw />, onSelect: () => reactivate.mutate(user.id) }]
        : []),
  ];

  return (
    <div className="flex justify-start" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <WzDotsMenu items={items} aria-label={`Actions for ${name}`} />

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {user.firstName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access immediately. Their history is kept and you can
              reactivate them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deactivate.mutate(user.id)}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
