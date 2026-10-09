"use client";

import type { CallFlow } from "@bitcrm/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * A number's Flow on the numbers list (pg_settings_phone_wz_numbers: a
 * 38px react-select in the Flow column): every call flow by name; picking
 * one moves the number onto it. Clearing is the "Remove flow" link under it.
 */
export function NumberFlowSelect({
  flows,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  flows: readonly CallFlow[];
  value: string | undefined;
  onChange: (flowId: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-[38px] w-full" aria-label={ariaLabel}>
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        {flows.map((f) => (
          <SelectItem key={f.id} value={f.id}>
            {f.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
