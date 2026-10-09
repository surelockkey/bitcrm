import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A row of Workiz's permission list — "Edit permissions for role …"
 * (pg_admin_users_wz_10_role_dispatch, `userSettings_roles_Role`):
 *
 *   title     h5 14px/16px 600 ink ("Account Settings");
 *   sentence  14px/16px #404040 10px under it ("Access the account settings
 *             page and change preferences"), 5px under that;
 *   controls  at the right edge, level with the title — Workiz's one 40×20
 *             green switch (`WzSwitch`), or several, each with its words;
 *   rule      1px #ddd 56px down the row, the next row 24px under it (81px
 *             apart).
 *
 * The controls are the caller's: name each one (`aria-label`, or words in
 * its `<label>`).
 */
export function WzSwitchRow({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The switches, at the right. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="wz-switch-row"
      className={cn("mb-6 flex min-h-[57px] items-start gap-6 border-b border-wz-frame pb-[9px]", className)}
    >
      <div className="min-w-0 flex-1 pb-[5px]">
        <h5 className="text-sm leading-4 font-semibold tracking-[0.4px] text-foreground">{title}</h5>
        {description ? (
          <p data-slot="wz-switch-row-description" className="mt-2.5 text-sm leading-4 tracking-[0.4px] text-wz-strong">
            {description}
          </p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-6 gap-y-2">{children}</div> : null}
    </div>
  );
}
