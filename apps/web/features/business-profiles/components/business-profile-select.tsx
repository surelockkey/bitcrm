"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useActiveBusinessProfiles } from "../hooks";

// Radix Select items can't hold an empty string, so "none" uses a sentinel.
const NONE = "__no_company__";

export interface BusinessProfileSelectProps {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  /** Offer a clearable option (sends `null`). */
  allowNone?: boolean;
  noneLabel?: string;
  /** Label the default company "(default company)". */
  showDefaultHint?: boolean;
  /** Name to show when `value` isn't in the list (e.g. a job's snapshot). */
  fallbackName?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
}

/**
 * Picker over the company catalog (by name, active only). An archived — or
 * since-deleted — selection stays visible as "(archived)" so editing an old
 * job never silently blanks it.
 */
export function BusinessProfileSelect({
  value,
  onChange,
  allowNone = false,
  noneLabel = "No company",
  showDefaultHint = false,
  fallbackName,
  placeholder = "Select company",
  disabled,
  id,
  className,
  size = "default",
  "aria-label": ariaLabel = "Company",
}: BusinessProfileSelectProps) {
  const { data, active, isLoading, isError } = useActiveBusinessProfiles();
  const selectedMissing = value && !active.some((c) => c.id === value);
  const archivedName = selectedMissing
    ? ((data ?? []).find((c) => c.id === value)?.name ?? fallbackName)
    : undefined;
  const current = value || (allowNone ? NONE : "");

  return (
    <Select
      value={current}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} size={size} aria-label={ariaLabel} className={cn("w-full", className)}>
        <SelectValue placeholder={isLoading ? "Loading…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
        {selectedMissing && value && (archivedName || !isLoading) ? (
          <SelectItem value={value}>{`${archivedName ?? "Unknown company"} (archived)`}</SelectItem>
        ) : null}
        {active.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {showDefaultHint && c.isDefault ? `${c.name} (default company)` : c.name}
          </SelectItem>
        ))}
        {isError ? (
          <div className="px-2 py-1.5 text-xs text-destructive">Couldn&apos;t load companies</div>
        ) : !isLoading && active.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">No active companies</div>
        ) : null}
      </SelectContent>
    </Select>
  );
}
