"use client";

import { useRef, type ReactNode } from "react";
import { TableHead } from "@/components/ui/table";
import { COLUMN_MIN_WIDTH } from "@/lib/table/use-column-widths";
import { cn } from "@/lib/utils";

/** How far one arrow-key press moves an edge. */
const KEY_STEP = 16;

/**
 * A header cell whose right edge can be dragged to resize the column.
 *
 * The handle is a `separator`, not a button: it separates two columns and
 * carries a value, which is what lets a screen reader announce the width and
 * what makes the arrow keys expected rather than surprising. Resizing by mouse
 * alone would put the feature out of reach of anyone not using one.
 *
 * Only the width changes — the table stays `table-fixed` and the column's
 * declared width is the single thing being edited, so nothing reflows except
 * the two neighbours of the edge being moved.
 */
export function ResizableHead({
  columnId,
  label,
  width,
  onResize,
  onReset,
  sort,
  className,
  children,
}: {
  columnId: string;
  /** Named for the screen reader announcing the handle. */
  label: string;
  width: number;
  onResize: (px: number) => void;
  /** Double-click, or Home: put this column back to its default. */
  onReset?: () => void;
  /** This column orders the rows: Workiz's 3px bar and `aria-sort` (see TableHead). */
  sort?: "asc" | "desc";
  className?: string;
  children?: ReactNode;
}) {
  // The width at the moment the drag started; the pointer's travel is added
  // to it, so a slow drag does not accumulate rounding.
  const start = useRef<{ x: number; width: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLSpanElement>) {
    // Left button only, and never let the click reach a sortable header.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    start.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLSpanElement>) {
    if (!start.current) return;
    onResize(start.current.width + (e.clientX - start.current.x));
  }

  function onPointerUp(e: React.PointerEvent<HTMLSpanElement>) {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLSpanElement>) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onResize(width - KEY_STEP);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onResize(width + KEY_STEP);
    } else if (e.key === "Home" && onReset) {
      e.preventDefault();
      onReset();
    }
  }

  return (
    // Named explicitly: the handle is a child, and without this the header's
    // accessible name would be computed from its contents as
    // "Client Resize Client".
    <TableHead aria-label={label} sort={sort} className={cn("group relative truncate", className)}>
      {children ?? label}
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        aria-valuenow={width}
        aria-valuemin={COLUMN_MIN_WIDTH}
        tabIndex={0}
        data-testid={`resize-${columnId}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={onReset}
        // Sits on the edge and is wider than it looks: a 1px line is a
        // target nobody can hit, so the grab area is 9px with a hairline
        // drawn inside it.
        className={cn(
          "absolute -right-1 top-0 z-10 h-full w-2.5 cursor-col-resize touch-none select-none",
          "after:absolute after:inset-y-1.5 after:left-1 after:w-px after:bg-transparent",
          "hover:after:bg-border focus-visible:after:bg-ring focus-visible:outline-none",
        )}
      />
    </TableHead>
  );
}
