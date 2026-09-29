"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useJobSource } from "../hooks";
import { useActiveJobSources } from "../active-hooks";
import { activeJobSources } from "../lib";

// Radix Select items can't hold an empty string, so "no source" uses a sentinel.
const NONE = "__none__";

/**
 * Single-select over the job-source catalog for the deal forms. Selects by id,
 * and — because a deal's source is optional — offers a clearable "None" option.
 * An archived-but-selected source stays visible so editing an old deal doesn't
 * silently blank it.
 */
export function JobSourceSelect({
  value,
  onChange,
  triggerClassName,
  placeholder = "No source",
  disabled,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  triggerClassName?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  // Only what can be offered: 690 sources came over from Workiz and 239 are
  // still offered, and the rest were weight on every job page.
  const { data } = useActiveJobSources();
  const active = activeJobSources(data);

  // A job may still point at an archived source; fetch just that one so the
  // field shows its name instead of going blank.
  const needsArchived = Boolean(value) && !active.some((t) => t.id === value);
  const { data: archived } = useJobSource(value ?? "", needsArchived);
  const selectedArchived = needsArchived ? archived : undefined;

  return (
    <Select
      value={value || NONE}
      onValueChange={(v) => onChange(v === NONE ? undefined : v)}
      disabled={disabled}
    >
      <SelectTrigger className={triggerClassName ?? "h-9 w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No source</SelectItem>
        {selectedArchived ? (
          <SelectItem value={selectedArchived.id}>{selectedArchived.name} (archived)</SelectItem>
        ) : null}
        {active.map((jobSource) => (
          <SelectItem key={jobSource.id} value={jobSource.id}>
            {jobSource.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
