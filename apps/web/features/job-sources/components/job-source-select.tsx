"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useJobSources } from "../hooks";
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
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  triggerClassName?: string;
  placeholder?: string;
}) {
  const { data } = useJobSources();
  const active = activeJobSources(data);

  const selectedArchived =
    value && !active.some((t) => t.id === value)
      ? (data ?? []).find((t) => t.id === value)
      : undefined;

  return (
    <Select
      value={value || NONE}
      onValueChange={(v) => onChange(v === NONE ? undefined : v)}
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
