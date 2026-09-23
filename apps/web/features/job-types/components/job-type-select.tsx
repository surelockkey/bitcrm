"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useJobType } from "../hooks";
import { useActiveJobTypes } from "../active-hooks";
import { activeJobTypes } from "../lib";

/**
 * Single-select over the job-type catalog for the deal forms. Selects by id.
 * When editing a deal whose type has since been archived, that id is injected
 * as an extra option so the current value still renders.
 */
export function JobTypeSelect({
  value,
  onChange,
  triggerClassName,
  placeholder = "Select",
  disabled,
}: {
  value: string | undefined;
  onChange: (id: string) => void;
  triggerClassName?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  // Only what can be offered: the full catalog is 898 rows to draw a list of
  // twenty-one, and that was a second of every job page.
  const { data } = useActiveJobTypes();
  const active = activeJobTypes(data);

  // A job may still point at an archived type; fetch just that one, so the
  // field shows its name instead of going blank.
  const needsArchived = Boolean(value) && !active.some((t) => t.id === value);
  const { data: archived } = useJobType(value ?? "", needsArchived);
  const selectedArchived = needsArchived ? archived : undefined;

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={triggerClassName ?? "h-9 w-full"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {selectedArchived ? (
          <SelectItem value={selectedArchived.id}>{selectedArchived.name} (archived)</SelectItem>
        ) : null}
        {active.map((jobType) => (
          <SelectItem key={jobType.id} value={jobType.id}>
            {jobType.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
