"use client";

import type { AutomationRule } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutomationRuns } from "../hooks";
import { OUTCOME_LABEL, formatFiredAt, outcomeTone, runSummary } from "../lib";

const TONE_CLASS: Record<string, string> = {
  ok: "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  warn: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  bad: "border-transparent bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  muted: "",
};

/** The rule's last firings: when, for which job, what happened. Kept 30 days. */
export function AutomationRunsDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule: AutomationRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: runs, isLoading } = useAutomationRuns(rule.id, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule.name}</DialogTitle>
          <DialogDescription>
            The last firings of this rule. {rule.workizTriggered
              ? `Workiz fired it ${rule.workizTriggered.toLocaleString()} times before the move.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !runs?.length ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            It has not fired here yet.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="automation-runs">
            {runs.map((run) => (
              <li key={run.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{formatFiredAt(run.firedAt)}</span>
                  <Badge variant="outline" className={TONE_CLASS[outcomeTone(run.outcome)]}>
                    {OUTCOME_LABEL[run.outcome]}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {run.entity} · {runSummary(run)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
