import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Workiz's Button-module (main.css on app.workiz.com), under the names the
 * app already uses:
 *
 *   default, brand  → primary   #fad400 pill, ink words; #eac300 hovered,
 *                                #dcb802 pressed. Every Workiz Save / Add New /
 *                                Create is this yellow, so `brand` is too.
 *   outline         → secondary  a 1px ink edge; #f3f6f7 hovered, #c8ced0 pressed.
 *   ghost           → tertiary   the secondary without its edge.
 *   secondary       → accent     #3589e9 with white words ("Upgrade plan").
 *   destructive     → danger     #f45e44 with white words; #d42a0c hovered.
 *   link            → the blue words of "Managing categories" (13px/600 #6aa8ee).
 *
 * Words are 13px/19px semibold ink with 0.2px tracking. Sizes: default is
 * Workiz's "regular" (32px), `sm` its "compact" (26px), `lg` its "big"
 * (40px). The icon sizes are IconButton-module squares (24px r4, 32/40px r8),
 * and an outlined one is the list toolbar's square grey-edged button
 * (Export, Fields). A disabled button greys out (#eff1f1, #9ea6aa words) the
 * way Workiz's login "Verify" does, rather than fading.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-pill border border-transparent bg-clip-padding text-[13px] leading-[19px] font-semibold tracking-[0.2px] whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-foreground hover:bg-wz-primary-hover active:bg-wz-primary-active aria-expanded:bg-wz-primary-hover disabled:bg-wz-disabled-fill disabled:text-wz-outline",
        brand:
          "bg-primary text-foreground hover:bg-wz-primary-hover active:bg-wz-primary-active aria-expanded:bg-wz-primary-hover disabled:bg-wz-disabled-fill disabled:text-wz-outline",
        outline:
          "border-foreground bg-transparent text-foreground hover:bg-wz-secondary-hover active:bg-wz-secondary-active aria-expanded:bg-wz-secondary-hover disabled:border-wz-outline disabled:text-wz-outline",
        secondary:
          "bg-brand text-white hover:bg-wz-accent-hover active:bg-wz-accent-hover aria-expanded:bg-wz-accent-hover disabled:bg-wz-disabled-fill disabled:text-wz-outline",
        ghost:
          "bg-transparent text-foreground hover:bg-wz-secondary-hover active:bg-wz-secondary-active aria-expanded:bg-wz-secondary-hover disabled:text-wz-outline",
        destructive:
          "bg-wz-danger text-white hover:bg-wz-danger-hover active:bg-wz-danger-active focus-visible:ring-destructive/30 disabled:bg-wz-disabled-fill disabled:text-wz-outline",
        link: "h-auto rounded-none bg-transparent px-0 text-wz-link underline-offset-4 hover:underline disabled:text-wz-outline",
      },
      size: {
        default: "h-8 gap-1 px-4 has-data-[icon=inline-start]:pl-3 has-data-[icon=inline-end]:pr-3",
        xs: "h-6 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[26px] gap-1 px-4 has-data-[icon=inline-start]:pl-3 has-data-[icon=inline-end]:pr-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1 px-6",
        icon: "size-8 rounded-[8px]",
        "icon-xs": "size-6 rounded-[4px] [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 rounded-[6px]",
        "icon-lg": "size-10 rounded-[8px] [&_svg:not([class*='size-'])]:size-5",
      },
    },
    compoundVariants: [
      // The list toolbar's square buttons: 1px #ccc, small corner, no ink edge.
      {
        variant: "outline",
        size: ["icon", "icon-xs", "icon-sm", "icon-lg"],
        class: "rounded-[4px] border-input",
      },
      // A link is words, not a box, whatever size it was given.
      { variant: "link", size: ["default", "xs", "sm", "lg"], class: "h-auto px-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
