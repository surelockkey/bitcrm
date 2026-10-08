"use client";

import { useQuery } from "@tanstack/react-query";
import type { CallTag } from "@bitcrm/types";
import { WzAddFilter, WzFilterField, WzFilterOptions } from "@/components/workiz/filter-bar";
import { WzDateRangePicker, type WzDateRange } from "@/components/workiz/date-range-picker";
import { queryKeys } from "@/lib/query-keys";
import { listTransferTargets } from "@/features/telephony/api";
import { REPORT_PRESET_LABEL, accountToday } from "@/features/reports/report-dates";
import { addableFilters, chipSummary, DIRECTION_OPTIONS, FILTER_KINDS, type CallFilterChip, type CallFilterKind } from "../call-filters";
import { CALLS_PRESETS, callsPresetRange } from "../date-presets";
import { STATUS_LABEL, type CallStatus } from "../lib";

const PRESETS = CALLS_PRESETS.map((id) => ({ id, label: REPORT_PRESET_LABEL[id] }));
const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as CallStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }));

/** The Workiz search box over each panel ("Search direction", "Search tags"). */
const SEARCH_LABEL: Record<CallFilterKind, string> = {
  direction: "Search direction",
  status: "Search status",
  user: "Search user",
  tag: "Search tags",
};

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
  // The teammates are a list to pick from, asked for once somebody reaches
  // for the User filter — not part of the page's first paint.
  const wantsUsers = chips.some((c) => c.kind === "user");
  const teammates = useQuery({
    queryKey: queryKeys.telephony.teammates(),
    queryFn: () => listTransferTargets(true),
    enabled: wantsUsers,
    staleTime: 60_000,
  });

  const options = (kind: CallFilterKind): { value: string; label: string }[] => {
    switch (kind) {
      case "direction":
        return DIRECTION_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
      case "status":
        return STATUS_OPTIONS;
      case "user":
        return (teammates.data ?? []).map((t) => ({ value: t.id, label: t.name }));
      case "tag":
        return callTags.map((t) => ({ value: t.id, label: t.name }));
    }
  };
  const labelOf = (kind: CallFilterKind, value: string) => options(kind).find((o) => o.value === value)?.label ?? value;
  const addable = addableFilters(chips, "", { direction: true, status: true, user: true, tag: callTags.length > 0 });

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
                searchLabel={SEARCH_LABEL[chip.kind]}
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
