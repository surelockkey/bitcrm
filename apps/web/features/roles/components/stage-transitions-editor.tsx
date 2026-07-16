"use client";

import { DealStage } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  SOURCE_STAGES,
  TARGET_STAGES,
  hasAllTransitions,
  hasExactTransition,
  hasWildcardTo,
  stageGroupLabel,
  stageLabel,
  toggleAllTransitions,
  toggleTransition,
  toggleWildcardTo,
} from "../lib";

/** Common "from any stage" shortcuts. */
const WILDCARD_TARGETS: DealStage[] = [
  DealStage.CANCELED,
  DealStage.ON_HOLD,
  DealStage.FOLLOW_UP,
];

export function StageTransitionsEditor({
  transitions,
  readOnly,
  onChange,
}: {
  transitions: string[];
  readOnly?: boolean;
  onChange: (next: string[]) => void;
}) {
  const all = hasAllTransitions(transitions);

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
        <label className="flex items-center gap-3">
          <Switch
            checked={all}
            disabled={readOnly}
            onCheckedChange={() => onChange(toggleAllTransitions(transitions))}
          />
          <span className="text-sm">
            <span className="font-medium">Allow all transitions</span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">*-&gt;*</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">From any stage →</span>
          {WILDCARD_TARGETS.map((to) => (
            <Chip
              key={to}
              label={stageLabel(to)}
              on={all || hasWildcardTo(transitions, to)}
              disabled={readOnly || all}
              onClick={() => onChange(toggleWildcardTo(transitions, to))}
            />
          ))}
        </div>
      </div>

      {all ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Every stage move is allowed. Turn off “Allow all transitions” to
          restrict specific moves.
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {SOURCE_STAGES.map((from) => (
            <div key={from} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
              <div className="flex w-44 flex-none items-center gap-2 pt-1">
                <span className="text-sm font-medium">{stageLabel(from)}</span>
                <span className="rounded border px-1 text-[9px] tracking-wide text-muted-foreground uppercase">
                  {stageGroupLabel(from)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {TARGET_STAGES.filter((to) => to !== from).map((to) => {
                  const covered = hasWildcardTo(transitions, to);
                  const exact = hasExactTransition(transitions, from, to);
                  return (
                    <Chip
                      key={to}
                      label={stageLabel(to)}
                      on={exact || covered}
                      viaRule={covered && !exact}
                      disabled={readOnly || covered}
                      onClick={() => onChange(toggleTransition(transitions, from, to))}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  on,
  viaRule,
  disabled,
  onClick,
}: {
  label: string;
  on: boolean;
  viaRule?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={viaRule ? "Allowed by a wildcard rule" : undefined}
      className={cn(
        "rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed",
        on
          ? viaRule
            ? "border-brand/30 bg-brand/10 text-brand"
            : "border-brand bg-brand text-brand-foreground"
          : "border-input bg-background text-muted-foreground enabled:hover:border-foreground/30 enabled:hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
