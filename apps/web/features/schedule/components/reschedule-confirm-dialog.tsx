"use client";

import { TriangleAlert } from "lucide-react";
import type { Deal } from "@bitcrm/types";
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
import { formatWzTime } from "@/components/workiz";
import type { ConflictReason } from "../lib";
import type { MoveBody } from "../reschedule";
import type { DirectoryUser } from "@/features/deals/hooks";
import { personName } from "@/features/deals/person-name";

/** A drop waiting for its yes: the job, its new schedule, and the row change if any. */
export interface RescheduleTarget {
  deal: Deal;
  body: MoveBody;
  /** The Timeline row it was dragged off (null = Unassigned); undefined when rows did not change. */
  fromTechId?: string | null;
  /** The Timeline row it was dropped on (null = Unassigned); undefined = the crew stays. */
  toTechId?: string | null;
  /** It was an unscheduled job, dragged in from the pane. */
  scheduling: boolean;
}

const REASON_LABELS: Record<ConflictReason, string> = {
  double_booked: "overlaps another job",
  time_off: "overlaps time off",
  out_of_hours: "is outside working hours",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 9, 09:00 AM - 11:00 AM". */
function when(date?: string, slot?: string): string {
  if (!date) return "unscheduled";
  const day = `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8))}`;
  const [a, b] = slot?.split("-") ?? [];
  return a && b ? `${day}, ${formatWzTime(a)} - ${formatWzTime(b)}` : day;
}

/** Ours: a drop asks before it saves, and says when the new slot clashes (Workiz saves on drop). */
export function RescheduleConfirmDialog({
  target,
  users,
  conflicts,
  onConfirm,
  onCancel,
}: {
  target: RescheduleTarget | null;
  users: Map<string, DirectoryUser>;
  conflicts: ConflictReason[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!target) return null;
  const { deal, body, fromTechId, toTechId, scheduling } = target;
  const moved = toTechId !== undefined && toTechId !== fromTechId;
  const techName = (id?: string | null) => (id ? (personName(users.get(id)) ?? "…") : "Unassigned");

  return (
    <AlertDialog open onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {scheduling ? "Schedule" : "Reschedule"} job #{deal.dealNumber}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <div>
                {when(deal.scheduledDate, deal.scheduledTimeSlot)} → <b>{when(body.scheduledDate, body.scheduledTimeSlot)}</b>
                {moved ? (
                  <>
                    {" "}· {techName(fromTechId)} → <b>{techName(toTechId)}</b>
                  </>
                ) : null}
              </div>
              {conflicts.length > 0 ? (
                <div className="flex items-start gap-1.5 rounded-[4px] border border-wz-toast-warning/50 bg-wz-toast-warning/10 px-2 py-1.5 text-foreground">
                  <TriangleAlert className="mt-0.5 size-4 flex-none text-wz-toast-warning" />
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
          <AlertDialogAction onClick={onConfirm}>{scheduling ? "Schedule" : "Reschedule"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
