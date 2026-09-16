"use client";

import { useMemo, useState } from "react";
import { Info, Loader2, Pencil, PlayCircle, RefreshCw, Workflow } from "lucide-react";
import type { AutomationLabelMap, AutomationRule } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTags } from "@/features/job-tags/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import {
  useAutomations,
  useAutomationsAccess,
  useMigrateAutomations,
  useUpdateAutomation,
} from "../hooks";
import { TRIGGER_LABEL, canEnable, firingCount, ruleSentence, sortRules } from "../lib";
import { AutomationFormDialog } from "./automation-form-dialog";
import { AutomationRunsDialog } from "./automation-runs-dialog";

/**
 * Settings → Automations (Workiz "Automation Center"). Every rule the
 * workspace has — the ones this service runs, the ones translated from the
 * Workiz export, and the ones that could not be — with the Workiz sentence
 * under each name, how often it has fired, and a switch.
 */
export function AutomationsPage() {
  const { canView, canEdit } = useAutomationsAccess();
  const { data: rules, isLoading } = useAutomations(canView);
  const update = useUpdateAutomation();
  const migrate = useMigrateAutomations();
  const [editing, setEditing] = useState<AutomationRule | undefined>();
  const [showing, setShowing] = useState<AutomationRule | undefined>();

  // Ids in a rule read as uuids; the catalogs turn them back into names.
  const { data: tags } = useJobTags();
  const { data: types } = useJobTypes();
  const { data: sources } = useJobSources();
  const { data: statuses } = useJobStatuses();
  const labels = useMemo<AutomationLabelMap>(() => {
    const map: AutomationLabelMap = {};
    for (const row of [...(tags ?? []), ...(types ?? []), ...(sources ?? []), ...(statuses ?? [])]) {
      map[row.id] = row.name;
    }
    return map;
  }, [tags, types, sources, statuses]);

  if (!canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view automations.</p>
      </div>
    );
  }

  const sorted = sortRules(rules ?? []);
  const running = sorted.filter((r) => r.enabled).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Automations</h2>
          <p className="text-sm text-muted-foreground">
            What the system sends on its own. {running} of {sorted.length} rules are on.
          </p>
        </div>
        {canEdit ? (
          // Writes the translation of every imported Workiz rule to its row,
          // so the specs can be edited and stop being recomputed on read.
          // Idempotent, and it never touches a rule somebody edited by hand.
          <Button
            variant="outline"
            size="sm"
            disabled={migrate.isPending}
            onClick={() => migrate.mutate(undefined)}
          >
            {migrate.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Re-check imported rules
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Workflow className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No automation rules</p>
          <p className="text-sm text-muted-foreground">Imported Workiz rules appear here once the history is loaded.</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">On</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead className="w-40">Trigger</TableHead>
                <TableHead className="w-24 text-right">Fired</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((rule) => {
                const enable = canEnable(rule);
                const fired = firingCount(rule);
                return (
                  <TableRow key={rule.id} data-testid={`automation-${rule.id}`}>
                    <TableCell>
                      <Switch
                        checked={rule.enabled}
                        disabled={!canEdit || (!enable && !rule.enabled) || update.isPending}
                        aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                        onCheckedChange={(enabled) => update.mutate({ id: rule.id, body: { enabled } })}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{rule.name}</span>
                        {rule.builtin ? <Badge variant="secondary">Built in</Badge> : null}
                        {!enable ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="gap-1 text-muted-foreground">
                                <Info className="size-3" /> Cannot run here
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm">
                              {rule.notRunnableReason ?? "This rule has nothing the engine can run."}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ruleSentence(rule, labels) || rule.description || "—"}
                      </p>
                      {rule.specNotes?.length ? (
                        <p className="mt-0.5 text-xs text-muted-foreground/80">{rule.specNotes[0]}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {rule.spec ? TRIGGER_LABEL[rule.spec.trigger.kind] : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      <button
                        type="button"
                        className="hover:underline"
                        onClick={() => setShowing(rule)}
                        aria-label={`Firings of ${rule.name}`}
                      >
                        {fired ?? 0}
                      </button>
                      {rule.workizTriggered ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {rule.workizTriggered.toLocaleString()} in Workiz
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Firing log of ${rule.name}`}
                          onClick={() => setShowing(rule)}
                        >
                          <PlayCircle className="size-4" />
                        </Button>
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${rule.name}`}
                            onClick={() => setEditing(rule)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {editing ? (
        <AutomationFormDialog
          rule={editing}
          open
          labels={labels}
          onOpenChange={(open) => !open && setEditing(undefined)}
        />
      ) : null}
      {showing ? (
        <AutomationRunsDialog rule={showing} open onOpenChange={(open) => !open && setShowing(undefined)} />
      ) : null}
    </div>
  );
}
