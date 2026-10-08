import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * "Required field" under a box (new_08_add_phone; `.validationSpan
 * .validationErr` in reactCss.css): 12px/10px regular #e35a36, 4px below the
 * box and 12px in. Workiz leaves the box's own edge grey.
 */
export function WzFieldError({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="wz-field-error"
      className={cn("mt-1 ml-3 text-[12px] leading-[10px] font-normal whitespace-nowrap text-wz-error", className)}
      {...props}
    />
  );
}

/**
 * The bold red notice under a block, e.g. "Please select a service area to
 * display available techs" (new_01_empty; `.styles__notValid` +
 * `.teamAssignment-module__notValid`): 12px/14px semibold #e35a36. Spacing
 * above it is the caller's — Workiz gives this one 15px.
 */
export function WzNotice({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="wz-notice"
      className={cn("text-[12px] leading-[14px] font-semibold text-wz-error", className)}
      {...props}
    />
  );
}
