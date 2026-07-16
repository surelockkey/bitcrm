"use client";

import { useState } from "react";
import {
  Ban,
  Eye,
  Loader2,
  MailPlus,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import type { User } from "@bitcrm/types";
import { UserStatus } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useHierarchy } from "../use-can-manage";
import { useDeactivateUser, useReactivateUser, useResendInvite } from "../hooks";

export function UserRowActions({
  user,
  onOpen,
}: {
  user: User;
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
  // An invite is only worth resending while the user hasn't come online yet
  // (i.e. still inactive). Surfaced as a dedicated row icon, not a menu item.
  const canResend = !isActive && can("users", "create");
  // "View" is always present above, so a separator is enough whenever a
  // destructive/reactivate action follows it.
  const showDangerSep = isActive ? canDelete : canReactivate;

  return (
    <div className="flex items-center justify-end gap-0.5">
      {canResend ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label="Resend invite"
              disabled={resend.isPending}
              onClick={(e) => {
                e.stopPropagation();
                resend.mutate(user.id);
              }}
            >
              {resend.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <MailPlus />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Resend invite</TooltipContent>
        </Tooltip>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Row actions"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-44"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem onClick={() => onOpen(user, "profile")}>
            <Eye />
            View
          </DropdownMenuItem>
          {canEdit ? (
            <DropdownMenuItem onClick={() => onOpen(user, "profile")}>
              <Pencil />
              Edit profile
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem onClick={() => onOpen(user, "role")}>
              <ShieldCheck />
              Change role
            </DropdownMenuItem>
          ) : null}
          {can("users", "create") ? (
            <DropdownMenuItem
              onClick={() => resend.mutate(user.id)}
              disabled={resend.isPending}
            >
              <MailPlus />
              Resend invite
            </DropdownMenuItem>
          ) : null}
          {showDangerSep ? <DropdownMenuSeparator /> : null}
          {isActive
            ? canDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirm(true)}
                >
                  <Ban />
                  Deactivate
                </DropdownMenuItem>
              )
            : canReactivate && (
                <DropdownMenuItem onClick={() => reactivate.mutate(user.id)}>
                  <RotateCcw />
                  Reactivate
                </DropdownMenuItem>
              )}
        </DropdownMenuContent>
      </DropdownMenu>

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
            <AlertDialogAction onClick={() => deactivate.mutate(user.id)}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
