"use client";

import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useContainer } from "@/features/inventory/containers/hooks";
import { useTemplateDiff } from "../hooks";

/** One height for every state of the strip: it never appears late and pushes the stock down. */
const STRIP = "flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-1.5";

/**
 * The strip above a van's stock: its template and how far the van is from it,
 * with Apply one click away — or, for a van without one, a way to set it.
 *
 * The van comes from the list row the popup was opened from (see
 * `useContainer`), so the strip is usually whole on the first frame; when it
 * isn't, it holds its height with a placeholder.
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

  if (!van.data) {
    return (
      <div data-testid="template-bar" aria-busy="true" className={STRIP}>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }
  if (!templateId) {
    return (
      <div data-testid="template-bar" className={STRIP}>
        <span className="text-sm text-muted-foreground">
          No template for this van.{" "}
          <Button variant="link" size="sm" className="h-auto p-0" onClick={onSetTemplate}>
            Set a template
          </Button>
        </span>
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
    <div data-testid="template-bar" className={STRIP}>
      <span className="text-sm">
        {d ? `Template: ${d.templateName} — ${state}` : <Skeleton className="h-4 w-56" />}
      </span>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => onApply(templateId)}>
        <ClipboardCheck />
        Apply template
      </Button>
    </div>
  );
}
