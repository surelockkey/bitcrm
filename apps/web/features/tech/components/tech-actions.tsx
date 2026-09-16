"use client";

import { useState } from "react";
import {
  CheckCheck,
  CircleCheckBig,
  Clock4,
  Loader2,
  MapPinCheck,
  Play,
  Send,
} from "lucide-react";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useMoveStatus } from "@/features/deals/hooks";
import { clockInTz } from "@/lib/timezone";
import { techActionState } from "../lib";
import {
  currentPosition,
  useConfirmReceipt,
  useMarkArrived,
  useOnMyWay,
  useRunningLate,
} from "../hooks";

/** How late, in minutes — the choices a technician actually taps (Workiz). */
export const LATE_CHOICES = [15, 30, 45, 60] as const;

/**
 * One big row in the action stack. Sized for a gloved thumb (56px), with the
 * verb first and the consequence underneath, because these are the buttons
 * somebody presses standing in a driveway.
 */
function ActionButton({
  label,
  hint,
  icon: Icon,
  onClick,
  busy,
  disabled,
  tone = "default",
  testId,
}: {
  label: string;
  hint?: string;
  icon: typeof Play;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "default" | "brand" | "done";
  testId?: string;
}) {
  return (
    <Button
      type="button"
      variant={tone === "brand" ? "brand" : "outline"}
      onClick={onClick}
      disabled={busy || disabled}
      data-testid={testId}
      className={cn(
        "h-14 w-full justify-start gap-3 rounded-xl px-4 text-left",
        tone === "done" &&
          "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40",
      )}
    >
      {busy ? <Loader2 className="size-5 animate-spin" /> : <Icon className="size-5" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{label}</span>
        {hint ? <span className="block truncate text-xs font-normal opacity-80">{hint}</span> : null}
      </span>
    </Button>
  );
}

/**
 * The technician's job actions, in the order the day runs: confirm you have
 * the job, tell the client you're coming (or that you're late), say you've
 * arrived, start the work, finish it.
 *
 * Each one is a single tap with no dialog to dismiss — except "Running late",
 * which has to ask how late. Buttons that have already happened drop out of
 * the stack and are replaced by the stamp, so the next thing to do is always
 * the top button.
 */
export function TechActions({ deal }: { deal: Deal }) {
  const { can } = usePermissions();
  const [lateOpen, setLateOpen] = useState(false);
  const state = techActionState(deal);

  const confirm = useConfirmReceipt(deal.id);
  const arrive = useMarkArrived(deal.id);
  const onMyWay = useOnMyWay(deal.id);
  const late = useRunningLate(deal.id);
  const move = useMoveStatus(deal.id);

  const canText = can("messages", "send");
  const canMove = can("deals", "move_status");

  /**
   * Ask the phone where it is, then record the arrival either way — a declined
   * permission or a fix that never comes must not cost the technician the tap.
   */
  const recordArrival = () => {
    void (async () => {
      const at = await currentPosition();
      arrive.mutate(at ?? {});
    })();
  };

  return (
    <div className="space-y-2" data-testid="tech-actions">
      {state.canConfirm ? (
        <ActionButton
          label="Confirm receipt"
          hint="Tells the office you've got this job"
          icon={CheckCheck}
          tone="brand"
          busy={confirm.isPending}
          onClick={() => confirm.mutate()}
          testId="tech-confirm"
        />
      ) : deal.techConfirmedAt ? (
        <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
          <CheckCheck className="size-4" aria-hidden /> Confirmed at {clockInTz(deal.techConfirmedAt)}
        </p>
      ) : null}

      {state.canNotify && canText ? (
        <>
          <ActionButton
            label="On my way"
            hint="Texts the client that you're heading over"
            icon={Send}
            busy={onMyWay.isPending}
            onClick={() => onMyWay.mutate(undefined)}
            testId="tech-on-my-way"
          />
          <ActionButton
            label="Running late"
            hint="Texts the client how much later you'll be"
            icon={Clock4}
            busy={late.isPending}
            onClick={() => setLateOpen((o) => !o)}
            testId="tech-late"
          />
          {lateOpen ? (
            <div className="flex flex-wrap gap-2 px-1 pb-1" data-testid="tech-late-choices">
              {LATE_CHOICES.map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant="outline"
                  size="lg"
                  disabled={late.isPending}
                  onClick={() => {
                    setLateOpen(false);
                    late.mutate(m);
                  }}
                >
                  {m} min
                </Button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {state.canArrive ? (
        <ActionButton
          label="Arrived"
          hint="Stamps the job — the office sees you're on site"
          icon={MapPinCheck}
          busy={arrive.isPending}
          onClick={recordArrival}
          testId="tech-arrived"
        />
      ) : deal.arrivedAt ? (
        <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
          <MapPinCheck className="size-4" aria-hidden /> Arrived at {clockInTz(deal.arrivedAt)}
        </p>
      ) : null}

      {canMove && state.canStart ? (
        <ActionButton
          label="Start job"
          hint="Moves the job to In Progress"
          icon={Play}
          busy={move.isPending}
          onClick={() => move.mutate({ superStatus: JobSuperStatus.IN_PROGRESS })}
          testId="tech-start"
        />
      ) : null}

      {canMove && state.canFinish ? (
        <ActionButton
          label="Done"
          hint="Marks the work finished"
          icon={CircleCheckBig}
          tone="done"
          busy={move.isPending}
          onClick={() => move.mutate({ superStatus: JobSuperStatus.DONE })}
          testId="tech-done"
        />
      ) : null}
    </div>
  );
}
