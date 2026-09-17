"use client";

import { Input } from "@/components/ui/input";
import { OFFSET_UNITS, type OffsetUnit } from "../../lib";
import type { PickerOption } from "../../components/automation-value-picker";
import type { ChainNode } from "../types";
import { PanelSentence, Slot } from "./controls";
import { useOffsetParts } from "./offset";

const UNIT_OPTIONS: PickerOption[] = OFFSET_UNITS.map((unit) => ({ id: unit, name: unit }));

/**
 * "Wait" (§5.4): how long the chain holds before the step under it. It is not
 * a field on any action — a wait before a step becomes that step's
 * `timing.delayMinutes` (§6) — which is why it is a step of its own here, and
 * why the Send panel reads its timing off the chain rather than offering a
 * second place to set the same number.
 */
export function WaitPanel({
  node,
  onChange,
  disabled,
}: {
  node: ChainNode;
  onChange: (next: ChainNode) => void;
  disabled?: boolean;
}) {
  // A wait only ever counts forward, so a number typed with a minus sign is
  // read as its size. The unit is remembered while the panel is open, so
  // clearing the box to retype does not turn "4 hours" into "4 minutes".
  const parts = useOffsetParts(Math.abs(node.waitMinutes ?? 0));
  const set = (minutes: number) => onChange({ ...node, waitMinutes: Math.abs(minutes) });

  return (
    <div className="space-y-3">
      <PanelSentence>
        <span>Wait</span>
        <Input
          type="number"
          min={0}
          className="h-8 w-20"
          aria-label="How long to wait"
          disabled={disabled}
          value={parts.value}
          onChange={(e) => {
            const typed = Math.abs(Number(e.target.value));
            set(parts.withValue(Number.isFinite(typed) ? typed : 0));
          }}
        />
        <Slot
          label="Wait unit"
          value={parts.unit}
          options={UNIT_OPTIONS}
          disabled={disabled}
          onChange={(unit) => set(parts.withUnit(unit as OffsetUnit))}
        />
        <span>before the step below.</span>
      </PanelSentence>
      <p className="text-xs text-muted-foreground">
        Outside the delivery window the rule holds rather than sends — the window at the foot of the
        builder decides that, not this step.
      </p>
    </div>
  );
}
