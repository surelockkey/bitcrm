"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAllTechnicians, useUserMap } from "@/features/technicians/hooks";

const NONE = "__unassigned__";

export interface TechnicianOption {
  id: string;
  name: string;
}

/**
 * Picks the technician assigned to a container. Emits `null` for "Unassigned".
 * If the current value isn't in the technicians list (e.g. deactivated), it is
 * kept selectable under `currentName` so opening the editor doesn't lose it.
 */
export function TechnicianSelect({
  id,
  value,
  currentName,
  onChange,
  disabled,
}: {
  id?: string;
  value: string | null;
  currentName?: string;
  onChange: (option: TechnicianOption | null) => void;
  disabled?: boolean;
}) {
  const { profiles } = useAllTechnicians(!disabled);
  const { data: userMap } = useUserMap();

  const options = useMemo(() => {
    const opts: TechnicianOption[] = profiles.map((p) => {
      const u = userMap?.get(p.userId);
      const name = u ? `${u.firstName} ${u.lastName}`.trim() : p.userId;
      return { id: p.userId, name };
    });
    if (value && !opts.some((o) => o.id === value)) {
      opts.push({ id: value, name: currentName || value });
    }
    return opts.sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, userMap, value, currentName]);

  return (
    <Select
      value={value ?? NONE}
      disabled={disabled}
      onValueChange={(v) => {
        if (v === NONE) return onChange(null);
        const option = options.find((o) => o.id === v);
        onChange(option ?? null);
      }}
    >
      <SelectTrigger id={id} className="h-10 w-full">
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Unassigned</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
