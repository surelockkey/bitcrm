"use client";

import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useContainerTemplate, useContainerTemplates } from "../hooks";

const NONE = "__none__";

/**
 * A van's template: the active ones, and "No template". A van that already
 * has one archived since keeps seeing it — the server lets it be saved back.
 */
export function TemplateSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string | null;
  onChange: (templateId: string | null) => void;
  disabled?: boolean;
}) {
  const active = useContainerTemplates();
  const listed = (active.data ?? []).some((t) => t.id === value);
  const own = useContainerTemplate(value ?? undefined, !!value && active.isSuccess && !listed);

  const options = useMemo(() => {
    const list = [...(active.data ?? [])];
    if (value && own.data && !list.some((t) => t.id === value)) list.push(own.data);
    return list;
  }, [active.data, own.data, value]);

  return (
    <Select
      value={value ?? NONE}
      disabled={disabled}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
    >
      <SelectTrigger id={id} className="h-10 w-full">
        <SelectValue placeholder="No template" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No template</SelectItem>
        {options.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
