"use client";

import type { TaxRate } from "@bitcrm/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useActiveTaxRates } from "@/features/tax-rates/hooks";
import { formatPercent, taxRateLabel } from "../lib";

/** Radix Select forbids an empty-string value, so "no tax" uses a sentinel. */
const NONE = "__no_tax__";

export interface TaxRateSelectProps {
  /** Selected tax-rate id; `null`/`undefined` = no tax. */
  value: string | null | undefined;
  onChange: (taxRateId: string | null) => void;
  disabled?: boolean;
  /** Offer a "No tax" option (default true). */
  allowNone?: boolean;
  /** Label of the "no tax" option (default "No tax"). */
  noneLabel?: string;
  /**
   * Shown when `value` isn't an active area tax (removed/area disabled) — e.g.
   * the document's snapshotted `taxRateName`.
   */
  fallbackLabel?: string;
  /** Snapshotted percent for the fallback option. */
  fallbackPercent?: number;
  placeholder?: string;
  id?: string;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
}

/**
 * Picker over the service areas' taxes ("Name x% · Area"). Data comes from one
 * shared cached list, so dropping several on one screen costs one request.
 */
export function TaxRateSelect({
  value,
  onChange,
  disabled,
  allowNone = true,
  noneLabel = "No tax",
  fallbackLabel,
  fallbackPercent,
  placeholder = "Select tax rate",
  id,
  className,
  size = "default",
  "aria-label": ariaLabel = "Tax rate",
}: TaxRateSelectProps) {
  const { active, isLoading, isError } = useActiveTaxRates();
  const current = value ?? (allowNone ? NONE : undefined);
  const missing = Boolean(value) && !active.some((r: TaxRate) => r.id === value);

  return (
    <Select
      value={current}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} size={size} aria-label={ariaLabel} className={cn("w-full", className)}>
        <SelectValue placeholder={isLoading ? "Loading…" : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value={NONE}>{noneLabel}</SelectItem> : null}
        {missing && value ? (
          <SelectItem value={value}>
            {fallbackLabel
              ? fallbackPercent !== undefined
                ? `${fallbackLabel} ${formatPercent(fallbackPercent)}`
                : fallbackLabel
              : "Unavailable rate"}
          </SelectItem>
        ) : null}
        {active.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {taxRateLabel(r)}
          </SelectItem>
        ))}
        {isError ? (
          <div className="px-2 py-1.5 text-xs text-destructive">Couldn&apos;t load tax rates</div>
        ) : !isLoading && active.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No service area charges tax — set one in Settings → Service Areas
          </div>
        ) : null}
      </SelectContent>
    </Select>
  );
}
