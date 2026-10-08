"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Workiz's toggle (toggleSwitch-module, small — "Taxable item", "Scheduled"):
 * 40×20, fully round, #50d58c on / #bbbbbb off, a 16px white knob 2px in,
 * 50ms. Disabled: #dddddd off, #b2e5c0 on (the same stylesheet's one-off
 * greys).
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-10 shrink-0 items-center rounded-full border-0 transition-colors duration-50 ease-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed data-[state=checked]:bg-wz-switch-on data-[state=unchecked]:bg-wz-switch-off disabled:data-[state=checked]:bg-[#b2e5c0] disabled:data-[state=unchecked]:bg-[#dddddd]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-white ring-0 transition-transform duration-50 ease-in data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
