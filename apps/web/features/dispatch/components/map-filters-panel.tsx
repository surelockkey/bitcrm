"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { JobSuperStatus } from "@bitcrm/types";
import { WzButton, WzCheckbox } from "@/components/workiz";
import { EMPTY_MAP_FILTERS, MAP_STATUSES, UNASSIGNED, toggleValue, type MapFilters } from "../map-filters";
import { mapStatusWord } from "../map-words";

interface Option {
  value: string;
  label: string;
}

function Section({
  title,
  options,
  picked,
  onToggle,
}: {
  title: string;
  options: Option[];
  picked: string[];
  onToggle: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <section
      aria-label={title}
      className="flex flex-col items-start gap-2 border-b border-border p-4"
    >
      <p className="text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-foreground">{title}</p>
      {/* Each row keeps an 8px margin under it inside the section's 8px gap: 37px apart. */}
      <div className="flex flex-col gap-2">
        {options.map((o) => (
          <WzCheckbox
            key={o.value}
            label={o.label}
            checked={picked.includes(o.value)}
            onCheckedChange={() => onToggle(o.value)}
            className="mb-2 [&>span]:tracking-[0.4px]"
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Workiz's "Filters" panel (pg_dispatch_wz_09_filter_*), in place of the
 * sidebar: "‹ Filters" and "Clear" over a #dfe2e3 rule, then Technician,
 * Service Area and Status — each a 13px semibold heading over browser
 * checkboxes 37px apart — and the yellow "Apply" pinned at the bottom. Ticks
 * wait for Apply; ‹ leaves them unapplied. Job Type is ours, last.
 */
export function MapFiltersPanel({
  value,
  techs,
  areas,
  jobTypes,
  onApply,
  onBack,
}: {
  value: MapFilters;
  /** Everyone, A→Z (the panel puts "Unassigned" first). */
  techs: Option[];
  areas: Option[];
  jobTypes: Option[];
  onApply: (filters: MapFilters) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<MapFilters>(value);
  const toggle = <K extends keyof MapFilters>(key: K, v: MapFilters[K][number]) =>
    setDraft((d) => ({ ...d, [key]: toggleValue(d[key] as MapFilters[K][number][], v) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="flex cursor-pointer text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-6" strokeWidth={1.6} />
          </button>
          <h2 className="text-[18px] leading-[27px] font-semibold tracking-[0.4px] text-foreground">Filters</h2>
        </div>
        <button
          type="button"
          onClick={() => setDraft(EMPTY_MAP_FILTERS)}
          className="cursor-pointer text-[13px] leading-[19px] tracking-[0.4px] text-foreground"
        >
          Clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section
          title="Technician"
          options={[{ value: UNASSIGNED, label: "Unassigned" }, ...techs]}
          picked={draft.techIds}
          onToggle={(v) => toggle("techIds", v)}
        />
        <Section title="Service Area" options={areas} picked={draft.areas} onToggle={(v) => toggle("areas", v)} />
        <Section
          title="Status"
          options={MAP_STATUSES.map((s) => ({ value: s, label: mapStatusWord(s) }))}
          picked={draft.statuses}
          onToggle={(v) => toggle("statuses", v as JobSuperStatus)}
        />
        <Section title="Job Type" options={jobTypes} picked={draft.jobTypeIds} onToggle={(v) => toggle("jobTypeIds", v)} />
      </div>
      <WzButton
        size="regular"
        onClick={() => onApply(draft)}
        className="m-4 w-[calc(100%-32px)] shadow-[0_-4px_8px_rgba(0,0,0,0.1)]"
      >
        Apply
      </WzButton>
    </div>
  );
}
