"use client";

import { ESTIMATE_STATUSES, type EstimateStatus } from "@bitcrm/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { EstimateStatusBadge } from "./estimate-status-badge";

export function EstimateStatusSelect({
  value,
  onChange,
  disabled,
  id,
  className,
}: {
  value: EstimateStatus;
  onChange: (status: EstimateStatus) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as EstimateStatus)} disabled={disabled}>
      <SelectTrigger id={id} size="sm" aria-label="Estimate status" className={cn("w-full", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ESTIMATE_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            <EstimateStatusBadge status={s} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
