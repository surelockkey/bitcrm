"use client";

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
import { formatWzTime } from "@/components/workiz";
import { DEFAULT_TZ, wallToCt, zoneAbbr, zonedInstant } from "@/lib/timezone";
import type { ConflictReason } from "../lib";
import type { RescheduleTarget } from "../reschedule";
import type { DirectoryUser } from "@/features/deals/hooks";
import { personName } from "@/features/deals/person-name";

export type { RescheduleTarget } from "../reschedule";

const REASON_LABELS: Record<ConflictReason, string> = {
  double_booked: "overlaps another job",
  time_off: "overlaps time off",
  out_of_hours: "is outside working hours",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const dayWords = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8))}`;

/**
 * "Oct 9, 09:00 AM - 11:00 AM EDT" — a visit stored on `zone`'s clock, read
 * on Connecticut's (2026-10-12 owner rule); a day without times stays a date.
 */
function when(date: string | undefined, slot: string | undefined, zone: string): string {
  if (!date) return "unscheduled";
  const [a, b] = slot?.split("-") ?? [];
  if (!a || !b) return dayWords(date);
  const start = wallToCt(date, a, zone);
  const end = wallToCt(date, b, zone);
  return `${dayWords(start.date)}, ${formatWzTime(start.time)} - ${formatWzTime(end.time)} ${start.abbr}`;
}

/** The same visit on its own clock: "Oct 12, 11:00 AM - 01:00 PM CDT". */
function localWhen(date: string, slot: string, zone: string): string {
  const [a, b] = slot.split("-");
  return `${dayWords(date)}, ${formatWzTime(a)} - ${formatWzTime(b)} ${zoneAbbr(zonedInstant(date, a, zone), zone)}`;
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
  const zone = target.zone || DEFAULT_TZ;
  // A job booked on another clock also says what the visit is there.
  const local = zone !== DEFAULT_TZ && body.scheduledTimeSlot ? localWhen(body.scheduledDate, body.scheduledTimeSlot, zone) : null;
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
                {when(deal.scheduledDate, deal.scheduledTimeSlot, zone)} → <b>{when(body.scheduledDate, body.scheduledTimeSlot, zone)}</b>
                {moved ? (
                  <>
                    {" "}· {techName(fromTechId)} → <b>{techName(toTechId)}</b>
                  </>
                ) : null}
              </div>
              {local ? <div className="text-xs">Job&apos;s local time: {local}</div> : null}
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
