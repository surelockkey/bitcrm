import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A Workiz text box with the label kept outside (pages put a <Label> above
 * it, so Workiz's 48px floating-label field cannot be a drop-in — that one is
 * `WzTextField` in components/workiz). The box itself is Workiz's: 40px, a 1px
 * #ccc rule that darkens to #b3b3b3 under the cursor and turns #ffd400 while
 * typing, a 4px corner, #808080 placeholder; disabled greys like their
 * disabled select; invalid edges go #e35a36. 14px words (16px on phones, so
 * iOS does not zoom) — between Workiz's 13px toolbar box and 16px form box.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-base text-foreground transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-wz-placeholder hover:border-wz-field-hover focus-visible:border-wz-focus disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-wz-disabled-border disabled:bg-wz-disabled disabled:text-wz-text aria-invalid:border-wz-error md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
