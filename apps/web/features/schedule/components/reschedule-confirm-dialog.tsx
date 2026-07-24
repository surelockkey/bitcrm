"use client";

import { TriangleAlert } from "lucide-react";
import type { User } from "@bitcrm/types";
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
import type { ConflictReason } from "../lib";
import type { RescheduleTarget } from "./day-grid";

const REASON_LABELS: Record<ConflictReason, string> = {
  double_booked: "overlaps another job",
  time_off: "overlaps time off",
  out_of_hours: "is outside working hours",
};

export function RescheduleConfirmDialog({
  target,
  users,
  conflicts,
  onConfirm,
  onCancel,
}: {
  target: RescheduleTarget | null;
  users: Map<string, User>;
  conflicts: ConflictReason[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!target) return null;
  const { deal, newTechId, newSlot } = target;
  const reassigned = newTechId !== deal.assignedTechId;
  const techName = (id?: string) => {
    if (!id) return "unassigned";
    const u = users.get(id);
    return u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email : id;
  };

  return (
    <AlertDialog open onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reschedule job #{deal.dealNumber}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <div>
                {deal.scheduledTimeSlot ?? "unscheduled"} → <b>{newSlot}</b>
                {reassigned ? (
                  <> · {techName(deal.assignedTechId)} → <b>{techName(newTechId)}</b></>
                ) : null}
              </div>
              {conflicts.length > 0 ? (
                <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-500">
                  <TriangleAlert className="mt-0.5 size-4 flex-none" />
                  <span>
                    This slot {conflicts.map((c) => REASON_LABELS[c]).join(", ")}. You can still proceed.
                  </span>
                </div>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Reschedule</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
