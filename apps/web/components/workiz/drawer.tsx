"use client";

import type { ComponentProps, ReactNode } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Workiz's side panel — "Visible fields" on every list (list_02,
 * uikit_wz_clients_fields), the job page's Address pane: a white panel on
 * the right (422px), the page dimmed by #666 at 60% (`.right-pane-container`)
 * with no blur. A 47px head:
 * 18px/600 ink title 24px in, a #607890 × at the right. The body scrolls,
 * 24px in. The footer (Cancel / a yellow "Save fields") is a 65px white
 * band with the 32px pills 21px down (list_02 / pg_contacts_wz_08: the
 * rows end at y≈935, the pills sit at 956), opaque, so the list scrolls
 * under it and never shows through (audit_pixels L16).
 *
 * Controlled (`open` / `onOpenChange`); `trigger` is optional and rendered
 * as the Dialog trigger (`asChild`).
 */
export function WzDrawer({
  open,
  onOpenChange,
  title,
  trigger,
  footer,
  width = 422,
  head = "plain",
  className,
  bodyClassName,
  footerClassName,
  onInteractOutside,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  trigger?: ReactNode;
  footer?: ReactNode;
  /** Panel width in px (Workiz's is 422). */
  width?: number;
  /**
   * Classes merged into the footer bar — Workiz's older pane buttons
   * (`_paneButtons`, "Add team member"): 15px down, 20px from the right,
   * 16px apart, a `0 0 5px rgba(50,50,50,.2)` glow. Default: the fields
   * panel's 21px / 24px / 9px.
   */
  footerClassName?: string;
  /**
   * A pointer or focus landing outside the panel; `preventDefault()` keeps
   * it open (a pick in a portalled list is not a click outside).
   */
  onInteractOutside?: ComponentProps<typeof Dialog.Content>["onInteractOutside"];
  /**
   * `plain` (default): the white head, title 24px in. `band`: Workiz's older
   * right pane (`right-pane-content`, the dashboard's "Dashboard widgets",
   * pg_dashboard_wz_settings_open) — a 49px #f7f7f7 band, the title centred,
   * a 1px #eeeeee rule under it.
   */
  head?: "plain" | "band";
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay
          data-slot="wz-drawer-overlay"
          className="fixed inset-0 z-50 bg-wz-scrim/60 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <Dialog.Content
          aria-describedby={undefined}
          data-slot="wz-drawer"
          onInteractOutside={onInteractOutside}
          style={width === 422 ? undefined : { width }}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-[422px] max-w-full flex-col bg-popover text-foreground shadow-[-4px_0_8px_rgba(0,0,0,0.12)] outline-none data-open:animate-in data-open:slide-in-from-right-10 data-closed:animate-out data-closed:slide-out-to-right-10",
            className,
          )}
        >
          <div
            data-head={head}
            className={cn(
              "flex shrink-0 items-center",
              head === "band"
                ? "relative h-[49px] justify-center border-b border-[#eeeeee] bg-muted px-10"
                : "h-[47px] justify-between pr-[15px] pl-6",
            )}
          >
            <Dialog.Title className="text-lg leading-[19px] font-semibold text-foreground">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className={cn(
                "grid size-6 place-items-center rounded-[4px] text-wz-close-icon outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                head === "band" && "absolute top-1/2 right-[13px] -translate-y-1/2",
              )}
            >
              <X className="size-[18px]" />
            </Dialog.Close>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-4", bodyClassName)}>{children}</div>
          {footer ? (
            <div className={cn("flex h-[65px] shrink-0 items-start justify-end gap-[9px] bg-popover px-6 pt-[21px]", footerClassName)}>
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A labelled group in a drawer: "USED FIELDS", "UNSELECTED FIELDS" (12px/500 #9ea6aa capitals). */
export function WzDrawerSection({ title, className, children }: { title: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("mb-4", className)}>
      <h6 className="mb-4 text-xs leading-[21px] font-medium tracking-[0.4px] text-wz-outline uppercase">{title}</h6>
      {children}
    </section>
  );
}
