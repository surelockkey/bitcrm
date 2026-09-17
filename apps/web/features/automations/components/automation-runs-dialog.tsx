"use client";

import Link from "next/link";
import type { AutomationRule } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useAutomationRuns } from "../hooks";
import { formatFiredAt } from "../lib";
import { RunActions, RunLine, RunOutcomeBadge } from "./automation-activity-run";

/**
 * The rule's last firings: when, for which job, what each action did — and,
 * for a firing that sent a message, the message as it went out and who it
 * went to (§4.6 item 1). Kept 30 days.
 */
export function AutomationRunsDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule: AutomationRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: runs, isLoading, isError, error } = useAutomationRuns(rule.id, open);

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
        ) : isError ? (
          // A failed request is not a rule that never fired — say which it is.
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            The log could not be loaded. {getApiErrorMessage(error)}
          </p>
        ) : !runs?.length ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            It has not fired here yet.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="automation-runs">
            {runs.map((run) => (
              <li key={run.id} data-testid={`firing-${run.id}`} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{formatFiredAt(run.firedAt)}</span>
                  <RunOutcomeBadge outcome={run.outcome} />
                </div>
                <RunLine run={run} />
                <RunActions run={run} />
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          <Link
            href={`/automations/activity?rule=${encodeURIComponent(rule.id)}`}
            className="text-primary hover:underline"
          >
            See every firing of this rule in Activity
          </Link>
        </p>
      </DialogContent>
    </Dialog>
  );
}
