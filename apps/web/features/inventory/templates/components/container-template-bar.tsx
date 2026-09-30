"use client";

import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useContainer } from "@/features/inventory/containers/hooks";
import { useTemplateDiff } from "../hooks";

/**
 * The strip above a van's stock: its template and how far the van is from it,
 * with Apply one click away — or, for a van without one, a way to set it.
 */
export function ContainerTemplateBar({
  containerId,
  onApply,
  onSetTemplate,
}: {
  containerId: string;
  onApply: (templateId: string) => void;
  onSetTemplate: () => void;
}) {
  const van = useContainer(containerId);
  const templateId = van.data?.templateId;
  // The comparison alone: no warehouse, so nothing about what could move.
  const diff = useTemplateDiff(templateId, containerId, undefined, !!templateId);

  if (!van.data) return null;
  if (!templateId) {
    return (
      <div className="text-sm text-muted-foreground">
        No template for this van.{" "}
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onSetTemplate}>
          Set a template
        </Button>
      </div>
    );
  }

  const d = diff.data;
  const state = d
    ? d.shortLineCount === 0
      ? "nothing missing"
      : `${d.shortLineCount} ${d.shortLineCount === 1 ? "line" : "lines"} missing`
    : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
      <span className="text-sm">
        {d ? `Template: ${d.templateName} — ${state}` : "Template set"}
      </span>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onApply(templateId)}>
        <ClipboardCheck />
        Apply template
      </Button>
    </div>
  );
}
