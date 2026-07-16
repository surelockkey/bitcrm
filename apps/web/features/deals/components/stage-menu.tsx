"use client";

import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { DealStage } from "@bitcrm/types";
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
import { Textarea } from "@/components/ui/textarea";
import { useAllowedStages, useChangeStage } from "../hooks";
import { stageLabel } from "../lib";

export function StageMenu({ dealId, disabled }: { dealId: string; disabled?: boolean }) {
  const { data: allowed, isLoading } = useAllowedStages(dealId);
  const changeStage = useChangeStage(dealId);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const stages = allowed ?? [];
  const noMoves = !isLoading && stages.length === 0;

  const pick = (stage: DealStage) => {
    if (stage === DealStage.CANCELED) {
      setCancelOpen(true);
      return;
    }
    changeStage.mutate({ stage });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5" disabled={disabled || noMoves || changeStage.isPending}>
            {changeStage.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {noMoves ? "No moves" : "Move stage"}
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {stages.map((s) => (
            <DropdownMenuItem
              key={s}
              onSelect={() => pick(s)}
              className={s === DealStage.CANCELED ? "text-destructive" : ""}
            >
              {stageLabel(s)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

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
    </>
  );
}
