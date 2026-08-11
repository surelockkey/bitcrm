"use client";

import { JobSuperStatus, type JobTagColor } from "@bitcrm/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { superStatusLabel } from "@/features/deals/lib";
import { useJobStatuses } from "../hooks";
import { groupJobStatuses, jobStatusMap, STATUS_SWATCH_CLASSES } from "../lib";

// A bare super-status is selected via this sentinel prefix; sub-statuses use their id.
const SUPER_PREFIX = "SUPER::";

function Dot({ color }: { color: JobTagColor }) {
  return <span className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_SWATCH_CLASSES[color])} />;
}
function SuperDot() {
  return <span className="inline-block size-2 shrink-0 rounded-full bg-muted-foreground/50" />;
}

export interface JobStatusValue {
  superStatus: JobSuperStatus;
  subStatusId?: string;
}

/**
 * The job-page status picker: a Workiz-style grouped dropdown. Each of the six
 * fixed super-statuses is a selectable row; the custom sub-statuses filed under
 * it appear indented beneath, each with its color. Selecting a sub-status also
 * sets its super-status; selecting a bare super-status clears any sub-status.
 * Fully controlled — the caller persists via `moveStatus`.
 */
export function JobStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: JobStatusValue;
  onChange: (v: JobStatusValue) => void;
  disabled?: boolean;
}) {
  const { data } = useJobStatuses();
  const map = jobStatusMap(data);
  const current = value.subStatusId ? map.get(value.subStatusId) : undefined;
  const groups = groupJobStatuses(data, { activeOnly: true, includeEmpty: true });

  const selectValue = value.subStatusId ?? `${SUPER_PREFIX}${value.superStatus}`;

  const handle = (v: string) => {
    if (v.startsWith(SUPER_PREFIX)) {
      onChange({ superStatus: v.slice(SUPER_PREFIX.length) as JobSuperStatus });
    } else {
      const sub = map.get(v);
      onChange({ superStatus: sub?.group ?? value.superStatus, subStatusId: v });
    }
  };

  const label = (
    <span className="inline-flex items-center gap-1.5">
      {current ? <Dot color={current.color} /> : <SuperDot />}
      {current?.name ?? superStatusLabel(value.superStatus)}
    </span>
  );

  if (disabled) return <span className="text-sm">{label}</span>;

  return (
    <Select value={selectValue} onValueChange={handle}>
      <SelectTrigger className="h-8 min-w-48" aria-label="Job status">
        {label}
      </SelectTrigger>
      <SelectContent>
        {groups.map((g) => (
          <SelectGroup key={g.group}>
            <SelectItem value={`${SUPER_PREFIX}${g.group}`}>
              <span className="inline-flex items-center gap-1.5 font-medium">
                <SuperDot /> {g.label}
              </span>
            </SelectItem>
            {g.statuses.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="inline-flex items-center gap-1.5 pl-4">
                  <Dot color={s.color} /> {s.name}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
