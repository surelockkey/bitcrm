"use client";

import { useState } from "react";
import { Ban, Check, Loader2 } from "lucide-react";
import { DealStage } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useAllowedStages, useChangeStage } from "../hooks";
import { STAGE_ORDER, stageLabel, stageTone } from "../lib";

/** Colour per stage tone, applied to the active/target nodes. */
const NODE_TONE: Record<string, string> = {
  submitted: "border-blue-500 bg-blue-500 text-white",
  progress: "border-amber-500 bg-amber-500 text-white",
  pending: "border-violet-500 bg-violet-500 text-white",
  closed: "border-emerald-500 bg-emerald-500 text-white",
  canceled: "border-border bg-muted text-muted-foreground",
};
const RING_TONE: Record<string, string> = {
  submitted: "ring-blue-400/40",
  progress: "ring-amber-400/40",
  pending: "ring-violet-400/40",
  closed: "ring-emerald-400/40",
  canceled: "ring-border",
};

// The linear pipeline shown in the stepper (CANCELED is a side-exit, not a step).
const PIPELINE: DealStage[] = STAGE_ORDER.filter((s) => s !== DealStage.CANCELED);

export function DealStageStepper({
  dealId,
  stage,
  canEdit,
}: {
  dealId: string;
  stage: DealStage;
  canEdit: boolean;
}) {
  const { data: allowed } = useAllowedStages(dealId);
  const changeStage = useChangeStage(dealId);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const allowedSet = new Set(allowed ?? []);
  const canceled = stage === DealStage.CANCELED;
  const currentIndex = PIPELINE.indexOf(stage);
  const pending = changeStage.isPending;

  const go = (target: DealStage) => {
    if (!canEdit || pending || target === stage) return;
    if (target === DealStage.CANCELED) {
      setCancelOpen(true);
      return;
    }
    if (!allowedSet.has(target)) return;
    changeStage.mutate({ stage: target });
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline
          </span>
          {pending ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
        {canEdit && !canceled && allowedSet.has(DealStage.CANCELED) ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => setCancelOpen(true)}
          >
            <Ban className="size-3.5" /> Cancel deal
          </Button>
        ) : null}
      </div>

      {canceled ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <Ban className="size-4" /> This deal was canceled.
        </div>
      ) : null}

      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {PIPELINE.map((s, i) => {
          const done = !canceled && i < currentIndex;
          const active = !canceled && s === stage;
          const tone = stageTone(s);
          const clickable = canEdit && !pending && allowedSet.has(s);
          return (
            <div key={s} className="flex min-w-[92px] flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full items-center">
                <span className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : done || active ? "bg-foreground/30" : "bg-border")} />
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => go(s)}
                  aria-label={`${stageLabel(s)}${clickable ? " — move here" : ""}`}
                  className={cn(
                    "grid size-7 flex-none place-items-center rounded-full border-2 text-[11px] font-bold transition",
                    active
                      ? cn(NODE_TONE[tone], "ring-4", RING_TONE[tone])
                      : done
                        ? "border-foreground/30 bg-foreground/10 text-foreground/60"
                        : "border-border bg-background text-muted-foreground",
                    clickable && !active && "cursor-pointer hover:border-foreground/50 hover:text-foreground",
                    !clickable && !active && "cursor-default",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </button>
                <span className={cn("h-0.5 flex-1", i === PIPELINE.length - 1 ? "opacity-0" : done ? "bg-foreground/30" : "bg-border")} />
              </div>
              <span
                className={cn(
                  "line-clamp-2 text-center text-[10.5px] leading-tight",
                  active ? "font-semibold text-foreground" : "text-muted-foreground",
                  clickable && !active && "text-foreground/70",
                )}
              >
                {stageLabel(s)}
              </span>
            </div>
          );
        })}
      </div>

      {canEdit && !canceled ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Click a highlighted step to move the deal. Only valid next stages are selectable.
        </p>
      ) : null}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this deal?</AlertDialogTitle>
            <AlertDialogDescription>
              A reason is required and will be recorded on the deal&apos;s timeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            rows={3}
            placeholder="Why is this deal being canceled?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={!reason.trim()}
              onClick={(e) => {
                e.preventDefault();
                changeStage.mutate(
                  { stage: DealStage.CANCELED, cancellationReason: reason.trim() },
                  { onSuccess: () => { setCancelOpen(false); setReason(""); } },
                );
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Cancel deal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
