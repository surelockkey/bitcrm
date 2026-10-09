"use client";

import { DealStage } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { WzSwitch } from "@/components/workiz/toggles";
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
const WILDCARD_TARGETS: DealStage[] = [DealStage.CANCELED, DealStage.ON_HOLD, DealStage.FOLLOW_UP];

/**
 * Which stage moves a role may make (ours; Workiz has no such rule). Drawn in
 * the Advanced tab's language: a Workiz switch row for "Allow all
 * transitions", the "from any stage" shortcuts, then a row per stage with its
 * targets as chips — #6aa8ee when allowed, pale blue when a wildcard allows
 * it.
 */
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
    <div className="max-w-[1462px]">
      <div className="flex items-center gap-3 border-b border-wz-frame pb-3">
        <WzSwitch
          aria-label="Allow all transitions"
          checked={all}
          disabled={readOnly}
          onCheckedChange={() => onChange(toggleAllTransitions(transitions))}
        />
        <span className="text-sm leading-4 font-semibold tracking-[0.4px] text-foreground">Allow all transitions</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-wz-frame py-3">
        <span className="mr-1 text-[13px] leading-[19px] text-wz-slate">From any stage →</span>
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

      {all ? (
        <p className="py-6 text-sm leading-4 text-wz-strong">
          Every stage move is allowed. Turn off “Allow all transitions” to restrict specific moves.
        </p>
      ) : (
        <div>
          {SOURCE_STAGES.map((from) => (
            <div key={from} className="flex flex-col gap-2 border-b border-wz-frame py-3 sm:flex-row sm:items-start">
              <div className="flex w-52 flex-none items-center gap-2 pt-1">
                <span className="text-sm leading-4 font-semibold tracking-[0.4px] text-foreground">{stageLabel(from)}</span>
                <span className="text-[11px] leading-4 tracking-[0.4px] text-wz-caption uppercase">{stageGroupLabel(from)}</span>
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
      aria-pressed={on}
      title={viaRule ? "Allowed by a wildcard rule" : undefined}
      className={cn(
        "rounded-chip border px-2 py-1 text-xs leading-4 tracking-[0.4px] transition-colors disabled:cursor-not-allowed",
        on
          ? viaRule
            ? "border-wz-option-soft bg-wz-option-soft text-foreground"
            : "border-wz-link bg-wz-link text-white"
          : "border-input bg-background text-wz-strong enabled:hover:border-wz-outline",
      )}
    >
      {label}
    </button>
  );
}
