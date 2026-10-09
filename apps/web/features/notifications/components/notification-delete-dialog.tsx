"use client";

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
import { useDeleteAutomation } from "@/features/automations/hooks";

/**
 * The trash on a row. Workiz deletes on the click; ours asks first — a row
 * is a rule and its firing log, and nothing brings them back.
 */
export function NotificationDeleteDialog({
  id,
  description,
  open,
  onOpenChange,
}: {
  id: string;
  /** The row's Description, so the question names what goes. */
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useDeleteAutomation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this notification?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={remove.isPending}
            onClick={(e) => {
              // Keep the dialog up while the request is in flight: a refusal belongs on this screen.
              e.preventDefault();
              remove.mutate(id, { onSuccess: () => onOpenChange(false) });
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
