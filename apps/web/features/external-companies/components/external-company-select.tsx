"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExternalCompanies } from "../hooks";
import { activeExternalCompanies } from "../lib";

// Radix Select items can't hold an empty string, so "no company" uses a sentinel.
const NONE = "__none__";

/**
 * Single-select over the external-company catalog for the job forms. Selects by
 * id, and — because a job's referring partner is optional — offers a clearable
 * "None" option. A disabled-but-selected company stays visible so editing an
 * old job doesn't silently blank it.
 */
export function ExternalCompanySelect({
  value,
  onChange,
  triggerClassName,
  placeholder = "No external company",
  disabled,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  triggerClassName?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const { data } = useExternalCompanies();
  const active = activeExternalCompanies(data);

  const selectedDisabled =
    value && !active.some((c) => c.id === value)
      ? (data ?? []).find((c) => c.id === value)
      : undefined;

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
        <SelectItem value={NONE}>No external company</SelectItem>
        {selectedDisabled ? (
          <SelectItem value={selectedDisabled.id}>
            {selectedDisabled.name} (disabled)
          </SelectItem>
        ) : null}
        {active.map((company) => (
          <SelectItem key={company.id} value={company.id}>
            {company.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
