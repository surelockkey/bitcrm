"use client";

import { useState } from "react";
import { Archive, MoreHorizontal, RotateCcw } from "lucide-react";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate } from "@bitcrm/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/features/auth/use-permissions";
import { useArchiveTemplate, useRestoreTemplate } from "../hooks";

/** The kebab: Archive / Restore. Edit and Apply have their own buttons beside it. */
export function TemplateRowActions({ template }: { template: ContainerTemplate }) {
  const { can } = usePermissions();
  const archive = useArchiveTemplate();
  const restore = useRestoreTemplate();
  const [confirm, setConfirm] = useState(false);

  const isActive = template.status !== InventoryStatus.ARCHIVED;
  // A kebab that opens onto nothing is worse than no kebab.
  if (isActive ? !can("containers", "delete") : !can("containers", "edit")) return null;

  return (
    <>
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
        <DropdownMenuContent align="end" className="w-40" onClick={(e) => e.stopPropagation()}>
          {isActive ? (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
              <Archive />
              Archive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => restore.mutate(template.id)}>
              <RotateCcw />
              Restore
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{template.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Vans that use it keep it; it leaves the pickers. You can restore it
              later from the Archived filter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => archive.mutate(template.id)}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
