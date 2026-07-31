"use client";

import type { JobTagColor } from "@bitcrm/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useJobStatuses } from "../hooks";
import { groupJobStatuses, jobStatusMap, STATUS_SWATCH_CLASSES } from "../lib";

// Radix disallows an empty-string SelectItem value, so "no status" gets a sentinel.
const NONE = "__none__";

function Dot({ color }: { color: JobTagColor }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_SWATCH_CLASSES[color])} />;
}

/**
 * The job-page status picker: a Workiz-style grouped dropdown where the
 * super-statuses are headers and the custom sub-statuses are colored options.
 * Fully controlled — `onChange("")` clears the status. Shows the current status
 * (even if archived) resolved from the full catalog so the trigger never blanks.
 */
export function JobStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { data, isLoading } = useJobStatuses();
  const current = value ? jobStatusMap(data).get(value) : undefined;
  const groups = groupJobStatuses(data, { activeOnly: true });

  if (disabled) {
    if (!value) return <span className="text-sm text-muted-foreground">No status</span>;
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        {current ? <Dot color={current.color} /> : null}
        {current?.name ?? (isLoading ? "…" : value)}
      </span>
    );
  }

  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger className="h-8 min-w-[11rem]" aria-label="Job status">
        {current ? (
          <span className="inline-flex items-center gap-1.5">
            <Dot color={current.color} />
            {current.name}
          </span>
        ) : value ? (
          <span className="text-muted-foreground">{isLoading ? "Loading…" : value}</span>
        ) : (
          <span className="text-muted-foreground">Set status</span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground">No status</span>
        </SelectItem>
        {groups.map((g) => (
          <SelectGroup key={g.group}>
            <SelectLabel>{g.label}</SelectLabel>
            {g.statuses.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="inline-flex items-center gap-1.5">
                  <Dot color={s.color} />
                  {s.name}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
