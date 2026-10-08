import { useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface WzCardProps extends Omit<ComponentProps<"section">, "title"> {
  title: ReactNode;
  /** At the right of the title, top-aligned with it (the Scheduled toggle). */
  action?: ReactNode;
  /** Classes for the content box. */
  contentClassName?: string;
}

/**
 * A New Job card (`styles__jobCard.cardPadding24`, new_01_empty): white, 8px
 * corners, `0 2px 8px rgba(0,0,0,.067)`; heading 24px in with the h5's
 * 10px/15px margins, so the title sits 24px / 34px from the corner at
 * 18px/23.4px medium ink; content padded 0 24px 24px, its rows 10px apart
 * (`styles__field`). Cards in one grid row stretch to the tallest (h-full).
 */
export function WzCard({ title, action, className, contentClassName, children, ...rest }: WzCardProps) {
  const titleId = useId();
  return (
    <section
      {...rest}
      aria-labelledby={titleId}
      data-slot="wz-card"
      className={cn("h-full min-h-[110px] rounded-[8px] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.067)]", className)}
    >
      <div className="flex items-start px-6 pt-6">
        <h5
          id={titleId}
          className="mt-2.5 mb-[15px] grow text-[18px] leading-[1.3em] font-medium text-foreground"
        >
          {title}
        </h5>
        {action ? <div className="mt-2.5 flex shrink-0">{action}</div> : null}
      </div>
      <div className={cn("flex flex-col gap-2.5 px-6 pt-2.5 pb-6", contentClassName)}>{children}</div>
    </section>
  );
}

export interface WzSectionHeaderProps extends ComponentProps<"h4"> {
  /** A switch ("Schedule") or a button ("Send") at the right. */
  action?: ReactNode;
}

/**
 * A section title on the job page's Details tab ("Client", "Schedule", "Job",
 * "Team", "Extra Info"; `details-module__section > h4`): 18px/22px semibold
 * #404040, 10px above and below, a 1px #cad3d6 rule, 20px to the first field.
 * With an action the row is a flex line; a switch keeps Workiz's 16px line
 * (the header is then 41px), a button centres (53px with "Send").
 */
export function WzSectionHeader({ action, className, children, ...rest }: WzSectionHeaderProps) {
  return (
    <h4
      {...rest}
      data-slot="wz-section-header"
      className={cn(
        "mb-5 border-b border-wz-rule py-2.5 text-[18px] leading-[22px] font-semibold text-wz-strong",
        action ? "flex justify-between" : undefined,
        action ? "items-center has-[[data-slot=wz-switch]]:items-stretch has-[[data-slot=wz-switch]]:leading-4" : undefined,
        className,
      )}
    >
      {children}
      {action}
    </h4>
  );
}

/**
 * The bar pinned under the form (`.sbmt_bar`): white, 15px above and below a
 * 40px button, centred, with Workiz's `5px 1px 7px rgba(50,50,50,.55)`
 * shadow. Put it after the page's scroll region so it stays at the bottom of
 * the content column.
 */
export function WzActionBar({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div
      role="toolbar"
      {...rest}
      data-slot="wz-action-bar"
      className={cn(
        "relative z-[100] flex shrink-0 items-center justify-center gap-5 bg-white py-[15px] shadow-[5px_1px_7px_rgba(50,50,50,0.55)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
