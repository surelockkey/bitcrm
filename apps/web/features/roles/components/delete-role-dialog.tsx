"use client";

import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
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
import type { Role } from "@bitcrm/types";
import { useDeleteRole } from "../hooks";
import type { RoleEditability } from "../use-role-access";

export function DeleteRoleDialog({
  role,
  editability,
  open,
  onOpenChange,
}: {
  role: Role;
  editability: RoleEditability;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const deleteRole = useDeleteRole();

  const blocked = !editability.deletable;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {blocked ? `Can’t delete “${role.name}”` : `Delete “${role.name}”?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {blocked
              ? editability.deleteReason
              : "This permanently removes the role. This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {blocked ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-500">
            <TriangleAlert className="mt-0.5 size-4 flex-none" />
            <span>Resolve the blocker above, then try again.</span>
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>{blocked ? "Close" : "Cancel"}</AlertDialogCancel>
          {!blocked ? (
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                deleteRole.mutate(role.id, {
                  onSuccess: () => {
                    onOpenChange(false);
                    router.push("/admin/roles");
                  },
                })
              }
            >
              Delete role
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
