"use client";

import type { AutomationRule } from "@bitcrm/types";
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
import { useDeleteAutomation } from "../hooks";
import { firingCount } from "../lib";

/**
 * Deleting a rule is the one action on this page nothing undoes: the rule and
 * its firing log go together. A rule that has fired says so, so nobody
 * removes a working automation thinking it is a leftover import.
 */
export function AutomationDeleteDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule: AutomationRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useDeleteAutomation();
  const fired = firingCount(rule);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{rule.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {fired
              ? `It has fired ${fired.toLocaleString()} times here. Deleting removes the rule and its firing log. This can't be undone.`
              : "Deleting removes the rule and its firing log. This can't be undone."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            disabled={remove.isPending}
            onClick={(e) => {
              // Keep the dialog up while the request is in flight: a 422 from
              // the backend (a built-in rule) belongs on this screen.
              e.preventDefault();
              remove.mutate(rule.id, { onSuccess: () => onOpenChange(false) });
            }}
          >
            Delete rule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
