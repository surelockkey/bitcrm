import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * Workiz's labels (uikit_wz_set_team "2FA", the sidebar "NEW", the filter
 * chips): near-square, 11px/500 on a 13px line, 1px 4px. `secondary` is
 * their link-blue chip, `destructive` their red counter colour, `outline` the
 * white filter chip with a #ccc edge; `default` stays the yellow.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-auto min-h-[15px] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-chip border border-transparent px-1 py-px text-[11px] leading-[13px] font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-foreground [a]:hover:bg-wz-primary-hover",
        secondary: "bg-wz-link text-white [a]:hover:bg-brand",
        destructive:
          "bg-wz-danger text-white focus-visible:ring-destructive/20 [a]:hover:bg-wz-danger-hover",
        outline:
          "border-input bg-white text-wz-value [a]:hover:bg-muted",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-wz-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
