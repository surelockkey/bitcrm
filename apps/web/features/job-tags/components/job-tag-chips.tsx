"use client";

import { cn } from "@/lib/utils";
import { useJobTags } from "../hooks";
import { jobTagMap, tagColorClasses, tagSolidClasses } from "../lib";

/**
 * Renders a deal's job tags as colored chips, resolving ids through the catalog.
 * The single display component for the card, summary and detail views. Unknown
 * ids (e.g. a purged tag) fall back to a neutral chip showing the raw id.
 */
export function JobTagChips({
  ids,
  max,
  className,
  solid = false,
}: {
  ids: string[] | undefined;
  /** Cap the number shown; the rest collapse into a "+N" chip. */
  max?: number;
  className?: string;
  /**
   * The jobs list, the way Workiz shows it: each tag a solid block of its own
   * colour, in capitals, one under another. A dispatcher scanning the list
   * reads colour first and words second, and the outlined form recedes too far
   * to do that. Elsewhere — on the job card, in pickers — the quiet form is
   * still what belongs.
   */
  solid?: boolean;
}) {
  const { data, isLoading } = useJobTags();
  const map = jobTagMap(data);

  if (!ids?.length) return null;
  const shown = typeof max === "number" ? ids.slice(0, max) : ids;
  const extra = ids.length - shown.length;

  return (
    <div
      className={cn(
        solid ? "flex flex-col items-start gap-0.5" : "flex flex-wrap items-center gap-1",
        className,
      )}
    >
      {shown.map((id) => {
        const tag = map.get(id);
        // Until the catalog loads, a skeleton beats flashing the raw id.
        if (!tag && isLoading) {
          return <span key={id} className="inline-block h-4 w-12 animate-pulse rounded-full bg-muted" />;
        }
        return (
          <span
            key={id}
            className={cn(
              "inline-flex max-w-[190px] items-center truncate",
              solid
                ? "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                : "rounded-chip border px-2 py-0.5 text-[11px] font-medium",
              tag
                ? solid
                  ? tagSolidClasses(tag.color)
                  : tagColorClasses(tag.color)
                : "border-border bg-muted/60 text-muted-foreground",
            )}
            title={tag?.name ?? id}
          >
            {tag?.name ?? id}
          </span>
        );
      })}
      {extra > 0 ? (
        <span className="inline-flex items-center rounded-chip border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
