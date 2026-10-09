"use client";

import { useId, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Workiz's full-window modal (`_full modal rModal`), the role editor's
 * "Edit permissions for role dispatch" (pg_admin_users_wz_10_role_dispatch),
 * drawn by a page that has its own address — the editor routes of Admin →
 * Roles and a user's permissions:
 *
 *   window  fixed over everything, 16px corners, #f7f7f7 shell with the
 *           Dialog's shadow over a black-30% backdrop; the white body inside
 *           24px in, scrolling;
 *   title   h4 18px/27px 600 ink at 24/24 (`titleAfter` beside it), a thin
 *           × at the top right that closes;
 *   footer  80px white, `0 0 5px rgba(50,50,50,.2)`, the buttons 16px apart
 *           at the right, 80px from the edge (Workiz leaves the chat bubble
 *           its corner).
 *
 * Under the window's z-index of the app's dialogs and menus (z-50): the
 * confirmations and selects a page opens come up over it. Not a dialog — a
 * page: no focus trap, Back leaves it, `onClose` is the caller's (it
 * navigates). For a real modal over a list use `WzFormModal variant="full"`.
 */
export function WzWindowFrame({
  title,
  titleAfter,
  onClose,
  closeLabel = "Close",
  footer,
  className,
  children,
}: {
  title: ReactNode;
  /** Beside the title: chips ("System", "Custom permissions"). */
  titleAfter?: ReactNode;
  onClose: () => void;
  /** The ×'s accessible name. */
  closeLabel?: string;
  /** The footer's buttons (Cancel / Save); nothing draws no bar. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <div data-slot="wz-window-frame" className="fixed inset-0 z-40 bg-black/30">
      <section
        aria-labelledby={titleId}
        className={cn(
          "absolute inset-0 flex flex-col overflow-hidden rounded-[16px] bg-muted text-wz-strong",
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_0_3px_rgba(255,255,255,0.25),0_3px_9px_rgba(0,0,0,0.5)]",
          className,
        )}
      >
        <div className="relative min-h-0 flex-1 overflow-y-auto rounded-[16px] bg-background p-6">
          <div className="mb-6 flex min-w-0 items-center gap-3 pr-10">
            <h4 id={titleId} className="truncate text-lg leading-[27px] font-semibold tracking-[0.4px] text-foreground">
              {title}
            </h4>
            {titleAfter}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className="absolute top-6 right-6 flex size-7 cursor-pointer items-center justify-center rounded-[4px] text-foreground outline-none hover:text-wz-link focus-visible:ring-2 focus-visible:ring-wz-focus"
          >
            <X className="size-[18px]" strokeWidth={1.75} />
          </button>
          {children}
        </div>
        {footer ? (
          <div
            data-slot="wz-window-frame-footer"
            className="relative flex h-20 shrink-0 items-center justify-end gap-4 rounded-b-[16px] bg-background py-5 pr-20 pl-5 shadow-[0_0_5px_rgba(50,50,50,0.2)]"
          >
            {footer}
          </div>
        ) : null}
      </section>
    </div>
  );
}
