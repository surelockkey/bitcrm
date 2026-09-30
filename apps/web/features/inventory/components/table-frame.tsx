import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The bordered box every inventory table sits in.
 *
 * It scrolls sideways rather than clipping: the columns are `table-fixed` at
 * declared widths, so a reader who drags one wider — or a narrow window — makes
 * the table wider than the screen. Clipped, the last column read "Actio" and its
 * buttons simply weren't there; scrolled, they are one swipe away.
 */
export function TableFrame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div data-slot="table-frame" className={cn("overflow-x-auto border", className)}>
      {children}
    </div>
  );
}
