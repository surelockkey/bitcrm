"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useJobTypes } from "../hooks";
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
}: {
  value: string | undefined;
  onChange: (id: string) => void;
  triggerClassName?: string;
  placeholder?: string;
}) {
  const { data } = useJobTypes();
  const active = activeJobTypes(data);

  // Keep an archived-but-selected type visible so editing doesn't blank it.
  const selectedArchived =
    value && !active.some((t) => t.id === value)
      ? (data ?? []).find((t) => t.id === value)
      : undefined;

  return (
    <Select value={value} onValueChange={onChange}>
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
