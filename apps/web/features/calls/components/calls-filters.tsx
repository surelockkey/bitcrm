"use client";

import { useQuery } from "@tanstack/react-query";
import type { CallTag } from "@bitcrm/types";
import { WzAddFilter, WzFilterField, WzFilterOptions } from "@/components/workiz/filter-bar";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { queryKeys } from "@/lib/query-keys";
import { usePermissions } from "@/features/auth/use-permissions";
import { listTransferTargets } from "@/features/telephony/api";
import { useCallFlows } from "@/features/telephony/call-flows-hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { REPORT_PRESET_LABEL, accountToday } from "@/features/reports/report-dates";
import {
  addableFilters,
  chipSummary,
  FILTER_KINDS,
  FIXED_OPTIONS,
  type CallFilterChip,
  type CallFilterKind,
} from "../call-filters";
import { CALLS_PRESETS, callsPresetRange } from "../date-presets";

const PRESETS = CALLS_PRESETS.map((id) => ({ id, label: REPORT_PRESET_LABEL[id] }));

/**
 * The row over the stat cards (callspage_wz_01, _05_*, _06_*): the filter
 * chips and "+ Add filter" at the left, Workiz's date box at the right.
 * "AI filters" (Workiz's upsell) is not drawn — we have no AI search.
 */
export function CallsFilterRow({
  chips,
  onChipsChange,
  openKind,
  onOpenKind,
  callTags,
  range,
  onRangeChange,
}: {
  chips: CallFilterChip[];
  onChipsChange: (chips: CallFilterChip[]) => void;
  /** The chip whose panel is open (a new chip opens its own, as Workiz's does). */
  openKind: CallFilterKind | null;
  onOpenKind: (kind: CallFilterKind | null) => void;
  /** The active call-tag catalog; empty without `settings.view`, and then no Tags filter. */
  callTags: CallTag[];
  range: WzDateRange;
  onRangeChange: (range: WzDateRange) => void;
}) {
  const { can } = usePermissions();
  // The teammates and the call flows are lists to pick from, asked for once
  // somebody reaches for that filter — not part of the page's first paint.
  // The job sources are already in: the rows print them.
  const wants = (kind: CallFilterKind) => chips.some((c) => c.kind === kind);
  const teammates = useQuery({
    queryKey: queryKeys.telephony.teammates(),
    queryFn: () => listTransferTargets(true),
    enabled: wants("user"),
    staleTime: 60_000,
  });
  // The flow catalog sits behind `settings.view`, like the call-tag one.
  const mayFlows = can("settings");
  const flows = useCallFlows(mayFlows && wants("flow"));
  const sources = useJobSources();

  const options = (kind: CallFilterKind): { value: string; label: string }[] => {
    const fixed = FIXED_OPTIONS[kind];
    if (fixed) return fixed.map((o) => ({ value: o.value, label: o.label }));
    switch (kind) {
      case "flow":
        return (flows.data ?? []).map((f) => ({ value: f.id, label: f.name }));
      case "source":
        return (sources.data ?? []).map((s) => ({ value: s.id, label: s.name }));
      case "user":
        return (teammates.data ?? []).map((t) => ({ value: t.id, label: t.name }));
      case "tag":
        return callTags.map((t) => ({ value: t.id, label: t.name }));
      default:
        return [];
    }
  };
  const labelOf = (kind: CallFilterKind, value: string) => options(kind).find((o) => o.value === value)?.label ?? value;
  const addable = addableFilters(chips, "", {
    direction: true,
    status: true,
    duration: true,
    job: true,
    flow: mayFlows,
    source: (sources.data?.length ?? 0) > 0,
    user: true,
    tag: callTags.length > 0,
    masking: true,
  });

  const setValues = (kind: CallFilterKind, values: string[]) =>
    onChipsChange(chips.map((c) => (c.kind === kind ? { ...c, values } : c)));

  return (
    // Above the cards, the strip and the grid's pinned header: the date
    // list hangs down over them.
    <div className="sticky left-0 z-20 flex items-start gap-4 px-5 pt-6">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5 pt-px">
        {chips.map((chip) => {
          const def = FILTER_KINDS.find((k) => k.kind === chip.kind)!;
          const { name, value } = chipSummary(chip, labelOf);
          return (
            <WzFilterField
              key={chip.kind}
              name={name}
              value={value}
              open={openKind === chip.kind}
              onOpenChange={(o) => onOpenKind(o ? chip.kind : null)}
              onRemove={() => {
                onChipsChange(chips.filter((c) => c.kind !== chip.kind));
                if (openKind === chip.kind) onOpenKind(null);
              }}
            >
              <WzFilterOptions
                searchLabel={def.searchLabel}
                options={options(chip.kind)}
                selected={chip.values}
                multi={def.multi}
                onApply={(values) => {
                  setValues(chip.kind, values);
                  onOpenKind(null);
                }}
              />
            </WzFilterField>
          );
        })}
        <WzAddFilter
          kinds={addable.map((k) => ({ id: k.kind, label: k.label }))}
          onAdd={(id) => {
            const kind = id as CallFilterKind;
            onChipsChange([...chips, { kind, values: [] }]);
            onOpenKind(kind);
          }}
        />
      </div>
      <WzDateRangePicker
        presets={PRESETS}
        rangeOf={(id) => callsPresetRange(id as (typeof CALLS_PRESETS)[number], accountToday())}
        value={range}
        onChange={onRangeChange}
      />
    </div>
  );
}
