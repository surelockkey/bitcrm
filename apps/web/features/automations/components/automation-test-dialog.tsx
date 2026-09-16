"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { AutomationRule, AutomationRun } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTestAutomation } from "../hooks";

/**
 * "Try it against this job": the rule is evaluated against the job as it is
 * right now and every message it would send is rendered with that job's
 * data. Nothing is sent, nothing is logged — the answer is either the texts
 * or the reason the rule would not fire.
 */
export function AutomationTestDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule: AutomationRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const test = useTestAutomation();
  const [dealId, setDealId] = useState("");
  const [result, setResult] = useState<AutomationRun | null>(null);

  const run = async () => {
    if (!dealId.trim()) return;
    try {
      setResult(await test.mutateAsync({ id: rule.id, dealId: dealId.trim() }));
    } catch {
      /* toasted */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Test “{rule.name}”</DialogTitle>
          <DialogDescription>
            Nothing is sent. The rule is checked against the job and every message is rendered with its data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="automation-test-job">Job id</Label>
            <Input
              id="automation-test-job"
              value={dealId}
              placeholder="0f5c…"
              onChange={(e) => setDealId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
            />
          </div>

          {result ? (
            result.actions.length ? (
              <div className="space-y-2" data-testid="automation-test-result">
                {result.actions.map((action, i) => (
                  <div key={i} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{action.to ?? action.type}</span>
                      <Badge variant={action.outcome === "dry_run" ? "secondary" : "outline"}>
                        {action.outcome === "dry_run" ? "Would send" : action.outcome.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    {action.body ? (
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{action.body}</p>
                    ) : action.error ? (
                      <p className="mt-1 text-muted-foreground">{action.error}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="automation-test-result">
                This rule would not fire for that job{result.reason ? `: ${result.reason}` : "."}
              </p>
            )
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="brand" onClick={run} disabled={!dealId.trim() || test.isPending}>
            {test.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Run test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
