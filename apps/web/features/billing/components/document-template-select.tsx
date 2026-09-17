"use client";

import type { DocumentTemplateKind } from "@bitcrm/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDocumentTemplatesOfKind } from "../templates-api";

/** Radix Select forbids "", so "Automatic" (no explicit template) is a sentinel. */
const AUTO = "__auto__";

/**
 * Per-document template picker: "Automatic" (auto-apply rules → the default
 * template) or an explicit template of the document's kind.
 */
export function DocumentTemplateSelect({
  kind,
  value,
  onChange,
  disabled,
  id,
  className,
}: {
  kind: DocumentTemplateKind;
  value: string | undefined | null;
  onChange: (templateId: string | null) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const { templates, isLoading, isError } = useDocumentTemplatesOfKind(kind);
  const missing = Boolean(value) && !isLoading && !templates.some((t) => t.id === value);

  return (
    <Select
      value={value ?? AUTO}
      onValueChange={(v) => onChange(v === AUTO ? null : v)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} size="sm" aria-label="Template" className={cn("w-full", className)}>
        <SelectValue placeholder={isLoading ? "Loading…" : "Template"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={AUTO}>Automatic</SelectItem>
        {missing && value ? <SelectItem value={value}>Unavailable template</SelectItem> : null}
        {templates.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name}
            {t.isDefault ? " (default)" : ""}
          </SelectItem>
        ))}
        {isError ? (
          <div className="px-2 py-1.5 text-xs text-destructive">Couldn&apos;t load templates</div>
        ) : null}
      </SelectContent>
    </Select>
  );
}
