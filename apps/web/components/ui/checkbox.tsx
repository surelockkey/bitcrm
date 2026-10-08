"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Workiz's forms use the browser's own checkbox ("All-day event", "Show
 * unpaid jobs", the Visible fields panel): a 13×13 box, 1px #767676 edge,
 * 2px corner, filled with their link blue #6aa8ee and a white tick when on
 * (uikit_wz_clients_fields). Radix keeps the keyboard and `checked` /
 * `onCheckedChange` API; this only paints it the native way.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-[13px] shrink-0 rounded-[2px] border border-wz-native-check bg-white text-white outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-wz-link data-[state=checked]:bg-wz-link data-[state=indeterminate]:border-wz-link data-[state=indeterminate]:bg-wz-link",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        {props.checked === "indeterminate" ? (
          <MinusIcon className="size-2.5" strokeWidth={3} />
        ) : (
          <CheckIcon className="size-2.5" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
