"use client";

import { Copy, History, Info, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { AutomationLabelMap, AutomationRule } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  TRIGGER_LABEL,
  canEnable,
  categoryLabel,
  firingCount,
  formatEditedAt,
  formatFiredAt,
  ruleCategory,
  ruleSentence,
} from "../lib";

/**
 * One rule in "My automations" (§4.5): the switch, the name and its badges,
 * the Workiz sentence, and the one stats line Workiz shows — how often it
 * fired, when it last fired, when it was last edited.
 */
export function AutomationRuleCard({
  rule,
  labels,
  canEdit,
  busy,
  onToggle,
  onEdit,
  onDuplicate,
  onHistory,
  onDelete,
}: {
  rule: AutomationRule;
  labels?: AutomationLabelMap;
  canEdit: boolean;
  /** A mutation is in flight somewhere in the list — freeze the switch. */
  busy?: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onHistory: () => void;
  onDelete: () => void;
}) {
  const enable = canEnable(rule);
  const fired = firingCount(rule) ?? 0;
  const sentence = ruleSentence(rule, labels) || rule.description || "—";

  return (
    <div
      data-testid={`automation-${rule.id}`}
      className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40"
    >
      <Switch
        className="mt-0.5"
        checked={rule.enabled}
        disabled={!canEdit || (!enable && !rule.enabled) || busy}
        aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
        onCheckedChange={onToggle}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{rule.name}</span>
          <Badge variant="secondary">{categoryLabel(ruleCategory(rule))}</Badge>
          {rule.spec ? (
            <Badge variant="outline" className="text-muted-foreground">
              {TRIGGER_LABEL[rule.spec.trigger.kind]}
            </Badge>
          ) : null}
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

        <p className="mt-0.5 text-sm text-muted-foreground">{sentence}</p>
        {rule.specNotes?.length ? (
          <p className="mt-0.5 text-xs text-muted-foreground/80">{rule.specNotes[0]}</p>
        ) : null}

        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          <button
            type="button"
            className="hover:underline"
            onClick={onHistory}
            aria-label={`Firing log of ${rule.name}`}
          >
            {fired.toLocaleString()} {fired === 1 ? "firing" : "firings"}
          </button>
          {rule.workizTriggered ? (
            <>
              {" · "}
              <span>{rule.workizTriggered.toLocaleString()} in Workiz</span>
            </>
          ) : null}
          {rule.lastFiredAt ? (
            <>
              {" · "}
              <span>last fired {formatFiredAt(rule.lastFiredAt)}</span>
            </>
          ) : null}
          {rule.updatedAt ? (
            <>
              {" · "}
              <span>edited {formatEditedAt(rule.updatedAt)}</span>
            </>
          ) : null}
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${rule.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canEdit ? (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              Edit
            </DropdownMenuItem>
          ) : null}
          {canEdit ? (
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onHistory}>
            <History />
            View history
          </DropdownMenuItem>
          {canEdit ? (
            <>
              <DropdownMenuSeparator />
              {rule.builtin ? (
                // A built-in rule is part of the service; switching it off is
                // how it stops. Say so instead of offering a dead action —
                // in the menu itself, because a disabled item takes no focus
                // and a tooltip on it would never reach a keyboard.
                <>
                  <DropdownMenuItem disabled aria-label={`Delete ${rule.name}`}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                  <DropdownMenuLabel className="font-normal whitespace-normal">
                    A built-in rule is turned off, not deleted.
                  </DropdownMenuLabel>
                </>
              ) : (
                <DropdownMenuItem
                  variant="destructive"
                  aria-label={`Delete ${rule.name}`}
                  onClick={onDelete}
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              )}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
