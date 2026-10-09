"use client";

import type { ReactNode } from "react";
import { CheckCheck, ChevronDown, Clock4, Loader2, MapPinCheck, Play, Send, ThumbsUp } from "lucide-react";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WZ_MENU_POPUP, WZ_MENU_POPUP_ITEM } from "@/components/workiz/menu-popup";
import { wzPill } from "@/components/workiz/pill";
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

/** Workiz's 32px outline pill (the job page's "Upload" size). */
const PILL = wzPill("outline", "small");

/**
 * A step of the visit as a pill: the verb, with what it does in the tooltip
 * (and to a screen reader) — "Texts the client that you're heading over".
 */
function StepPill({
  label,
  hint,
  icon,
  onClick,
  busy,
  testId,
}: {
  label: string;
  hint: string;
  icon: ReactNode;
  onClick: () => void;
  busy?: boolean;
  testId: string;
}) {
  return (
    <button type="button" className={PILL} title={hint} onClick={onClick} disabled={busy} data-testid={testId}>
      {busy ? <Loader2 className="animate-spin" /> : icon}
      {label}
      <span className="sr-only">: {hint}</span>
    </button>
  );
}

/** A step that has happened: its stamp in the row's 13px ink. */
function Stamp({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] leading-[19.5px] whitespace-nowrap text-foreground [&_svg]:size-4 [&_svg]:text-wz-slate">
      {icon}
      {children}
    </span>
  );
}

/**
 * The technician's visit, as one more row of the job page's grey band —
 * "Visit:" under "Job name:", "Status:" and "Tags:", in their 13px label —
 * holding the steps in the order the day runs: confirm you have the job,
 * tell the client you're coming (or how late), say you've arrived, start
 * the work, finish it. Workiz's web job page has no such steps (its app has
 * Start and ETA), so they are ours, drawn as Workiz's 32px outline pills;
 * "Job Done" is Workiz's own word for the last one (its Actions menu).
 *
 * One tap each, no dialog — except "Running late", which asks how late in
 * Workiz's small MenuPopup. A step that has happened gives way to its stamp
 * ("Confirmed at 9:05 AM"), so the next thing to do is always the first pill;
 * a closed job keeps only its stamps, and with none the row is not drawn.
 */
export function TechActions({ deal }: { deal: Deal }) {
  const { can } = usePermissions();
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

  const steps: ReactNode[] = [];
  if (state.canConfirm) {
    steps.push(
      <StepPill
        key="confirm"
        label="Confirm receipt"
        hint="Tells the office you've got this job"
        icon={<CheckCheck />}
        busy={confirm.isPending}
        onClick={() => confirm.mutate()}
        testId="tech-confirm"
      />,
    );
  }
  if (state.canNotify && canText) {
    steps.push(
      <StepPill
        key="on-my-way"
        label="On my way"
        hint="Texts the client that you're heading over"
        icon={<Send />}
        busy={onMyWay.isPending}
        onClick={() => onMyWay.mutate(undefined)}
        testId="tech-on-my-way"
      />,
      <DropdownMenu key="late" modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={PILL} title="Texts the client how much later you'll be" disabled={late.isPending} data-testid="tech-late">
            {late.isPending ? <Loader2 className="animate-spin" /> : <Clock4 />}
            Running late
            <ChevronDown strokeWidth={1.25} />
            <span className="sr-only">: Texts the client how much later you&apos;ll be</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8} className={WZ_MENU_POPUP} data-testid="tech-late-choices">
          {LATE_CHOICES.map((m) => (
            <DropdownMenuItem key={m} className={WZ_MENU_POPUP_ITEM} onSelect={() => late.mutate(m)}>
              {m} min
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>,
    );
  }
  if (state.canArrive) {
    steps.push(
      <StepPill
        key="arrived"
        label="Arrived"
        hint="Stamps the job — the office sees you're on site"
        icon={<MapPinCheck />}
        busy={arrive.isPending}
        onClick={recordArrival}
        testId="tech-arrived"
      />,
    );
  }
  if (canMove && state.canStart) {
    steps.push(
      <StepPill
        key="start"
        label="Start job"
        hint="Moves the job to In Progress"
        icon={<Play />}
        busy={move.isPending}
        onClick={() => move.mutate({ superStatus: JobSuperStatus.IN_PROGRESS })}
        testId="tech-start"
      />,
    );
  }
  if (canMove && state.canFinish) {
    steps.push(
      <StepPill
        key="done"
        label="Job Done"
        hint="Marks the work finished"
        icon={<ThumbsUp strokeWidth={1.5} />}
        busy={move.isPending}
        onClick={() => move.mutate({ superStatus: JobSuperStatus.DONE })}
        testId="tech-done"
      />,
    );
  }

  const stamps: ReactNode[] = [];
  if (!state.canConfirm && deal.techConfirmedAt) {
    stamps.push(
      <Stamp key="confirmed" icon={<CheckCheck />}>
        Confirmed at {clockInTz(deal.techConfirmedAt)}
      </Stamp>,
    );
  }
  if (!state.canArrive && deal.arrivedAt) {
    stamps.push(
      <Stamp key="arrived" icon={<MapPinCheck />}>
        Arrived at {clockInTz(deal.arrivedAt)}
      </Stamp>,
    );
  }

  if (steps.length === 0 && stamps.length === 0) return null;

  return (
    // The band's header row (job-header.tsx HeaderRow): the 13px label, 8px
    // to what follows; 17px under Tags, as Tags is under Status.
    <div role="group" aria-label="Visit" className="mt-[17px] flex flex-wrap items-center gap-2" data-testid="tech-actions">
      <span className="shrink-0 text-[13px] leading-[19.5px] text-foreground">Visit:</span>
      {steps}
      {stamps.length ? <span className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-1">{stamps}</span> : null}
    </div>
  );
}
