import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Workiz's textarea (Price book "Item Description", the Manager Note custom
 * field): 1px #ccc, 4px corner, 8px 12px, #808080 placeholder, the #ffd400
 * edge while typing.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground transition-colors outline-none placeholder:text-wz-placeholder hover:border-wz-field-hover focus-visible:border-wz-focus disabled:cursor-not-allowed disabled:border-wz-disabled-border disabled:bg-wz-disabled disabled:text-wz-text aria-invalid:border-wz-error md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
