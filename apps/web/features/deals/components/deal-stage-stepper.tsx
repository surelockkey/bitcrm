"use client";

import { useState } from "react";
import { ArrowRight, Ban, Check, Loader2 } from "lucide-react";
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
import { GROUP_ORDER, STAGE_ORDER, groupLabel, stageGroup, stageLabel, stageTone } from "../lib";

/** Colours per group tone — mirrors the deals board grouping. */
const GROUP_TEXT: Record<string, string> = {
  submitted: "text-blue-600 dark:text-blue-400",
  progress: "text-amber-600 dark:text-amber-400",
  pending: "text-violet-600 dark:text-violet-400",
  closed: "text-emerald-600 dark:text-emerald-400",
  canceled: "text-muted-foreground",
};
const GROUP_BG: Record<string, string> = {
  submitted: "bg-blue-50/60 border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/60",
  progress: "bg-amber-50/60 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/60",
  pending: "bg-violet-50/60 border-violet-200 dark:bg-violet-950/20 dark:border-violet-900/60",
  closed: "bg-emerald-50/60 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/60",
  canceled: "bg-muted/40 border-border",
};
const NODE_ACTIVE: Record<string, string> = {
  submitted: "border-blue-500 bg-blue-500 text-white ring-blue-400/40",
  progress: "border-amber-500 bg-amber-500 text-white ring-amber-400/40",
  pending: "border-violet-500 bg-violet-500 text-white ring-violet-400/40",
  closed: "border-emerald-500 bg-emerald-500 text-white ring-emerald-400/40",
  canceled: "border-border bg-muted text-muted-foreground ring-border",
};
const NODE_TARGET: Record<string, string> = {
  submitted: "border-blue-400 text-blue-600 hover:bg-blue-500 hover:text-white dark:text-blue-300",
  progress: "border-amber-400 text-amber-600 hover:bg-amber-500 hover:text-white dark:text-amber-300",
  pending: "border-violet-400 text-violet-600 hover:bg-violet-500 hover:text-white dark:text-violet-300",
  closed: "border-emerald-400 text-emerald-600 hover:bg-emerald-500 hover:text-white dark:text-emerald-300",
  canceled: "border-border text-muted-foreground hover:bg-muted",
};
const GROUP_RING: Record<string, string> = {
  submitted: "ring-blue-400",
  progress: "ring-amber-400",
  pending: "ring-violet-400",
  closed: "ring-emerald-400",
  canceled: "ring-border",
};

const PIPELINE: DealStage[] = STAGE_ORDER.filter((s) => s !== DealStage.CANCELED);
const globalIndex = (s: DealStage) => PIPELINE.indexOf(s);

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
  const currentIndex = globalIndex(stage);
  const pending = changeStage.isPending;
  const movable = (allowed ?? []).filter((s) => s !== DealStage.CANCELED);

  const go = (target: DealStage) => {
    if (!canEdit || pending || target === stage) return;
    if (target === DealStage.CANCELED) { setCancelOpen(true); return; }
    if (!allowedSet.has(target)) return;
    changeStage.mutate({ stage: target });
  };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pipeline</span>
          {pending ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
        {canEdit && !canceled && allowedSet.has(DealStage.CANCELED) ? (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-destructive hover:text-destructive" disabled={pending} onClick={() => setCancelOpen(true)}>
            <Ban className="size-3.5" /> Cancel deal
          </Button>
        ) : null}
      </div>

      {canceled ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <Ban className="size-4" /> This deal was canceled.
        </div>
      ) : null}

      {/* Grouped pipeline — same colour groups as the deals board */}
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {GROUP_ORDER.map((group, gi) => {
          const stages = PIPELINE.filter((s) => stageGroup(s) === group);
          if (stages.length === 0) return null;
          const tone = stageTone(stages[0]);
          const hasCurrent = !canceled && stages.includes(stage);
          return (
            <div
              key={group}
              className={cn(
                "flex min-w-[150px] flex-1 flex-col gap-2 rounded-lg border p-2 transition",
                GROUP_BG[tone],
                hasCurrent ? cn("ring-2 ring-offset-1 ring-offset-background", GROUP_RING[tone]) : "opacity-95",
              )}
            >
              <div className={cn("flex items-center justify-between px-0.5 text-[11px] font-semibold uppercase tracking-wide", GROUP_TEXT[tone])}>
                <span>{groupLabel(group)}</span>
                {gi < GROUP_ORDER.length - 1 ? <ArrowRight className="size-3 opacity-50" /> : null}
              </div>
              <div className="flex items-start gap-1">
                {stages.map((s, i) => {
                  const idx = globalIndex(s);
                  const done = !canceled && idx < currentIndex;
                  const active = !canceled && s === stage;
                  const target = canEdit && !pending && allowedSet.has(s);
                  return (
                    <div key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div className="flex w-full items-center">
                        <span className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : done || active ? "bg-foreground/30" : "bg-border")} />
                        <button
                          type="button"
                          disabled={!target}
                          onClick={() => go(s)}
                          title={target ? `Move to ${stageLabel(s)}` : stageLabel(s)}
                          aria-label={`${stageLabel(s)}${target ? " — move here" : ""}`}
                          className={cn(
                            "grid size-7 flex-none place-items-center rounded-full border-2 text-[11px] font-bold transition",
                            active
                              ? cn(NODE_ACTIVE[tone], "ring-4")
                              : done
                                ? "border-foreground/30 bg-foreground/5 text-foreground/60"
                                : target
                                  ? cn("cursor-pointer bg-background ring-2 ring-offset-1 ring-offset-background", NODE_TARGET[tone], GROUP_RING[tone])
                                  : "border-border bg-background text-muted-foreground",
                          )}
                        >
                          {done ? <Check className="size-3.5" /> : idx + 1}
                        </button>
                        <span className={cn("h-0.5 flex-1", i === stages.length - 1 ? "opacity-0" : done ? "bg-foreground/30" : "bg-border")} />
                      </div>
                      <span className={cn("line-clamp-2 text-center text-[10px] leading-tight", active ? "font-semibold text-foreground" : target ? "font-medium text-foreground/80" : "text-muted-foreground")}>
                        {stageLabel(s)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Explicit "what can change" affordance */}
      {canEdit && !canceled ? (
        movable.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Move to:</span>
            {movable.map((s) => {
              const tone = stageTone(s);
              return (
                <button
                  key={s}
                  type="button"
                  disabled={pending}
                  onClick={() => go(s)}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition disabled:opacity-50", NODE_TARGET[tone])}
                >
                  <ArrowRight className="size-3" /> {stageLabel(s)}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground">No stage moves available from here.</p>
        )
      ) : null}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this deal?</AlertDialogTitle>
            <AlertDialogDescription>A reason is required and will be recorded on the deal&apos;s timeline.</AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea rows={3} placeholder="Why is this deal being canceled?" value={reason} onChange={(e) => setReason(e.target.value)} />
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
