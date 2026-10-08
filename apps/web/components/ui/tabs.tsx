"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

/**
 * Workiz has three tab looks, one per variant:
 *
 * - `default` — the scheduler's Day / Week / Month (uikit_wz_schedule
 *   `_schViews`): one 1px #ddd box with a 4px corner, 12px/500 words, a #ddd
 *   rule between them, the chosen one on #f8f8f8.
 * - `line` — the small tabs of the client page and Custom fields
 *   (Tabs-module): 13px/19px words 20px apart, slate (#566d76, 500) at rest,
 *   ink 600 when open over a 2px ink bar that sits on the rule below. The
 *   rule itself (Workiz: 1px #c4c4c4, full width) is the page's: most of
 *   ours already draw one on the row's container, and a second would double
 *   it — add `border-b border-wz-tab-rule` where there is none.
 * - `page` — the big Price book tabs (`_tabs`): a 1px #ccc rule, 16px/500
 *   words 25px apart, 600 when open over a 3px #3e4b51 bar.
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center text-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col",
  {
    variants: {
      variant: {
        default: "overflow-hidden rounded-[4px] border border-wz-frame bg-white p-0",
        line: "gap-0 rounded-none bg-transparent p-0",
        page: "gap-0 rounded-none border-b border-input bg-transparent p-0 group-data-horizontal/tabs:h-[47px] group-data-vertical/tabs:border-b-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // default: the segmented box.
        "group-data-[variant=default]/tabs-list:border-r group-data-[variant=default]/tabs-list:border-wz-frame group-data-[variant=default]/tabs-list:last:border-r-0 group-data-[variant=default]/tabs-list:px-2.5 group-data-[variant=default]/tabs-list:text-xs group-data-[variant=default]/tabs-list:font-medium group-data-[variant=default]/tabs-list:text-wz-strong group-data-[variant=default]/tabs-list:hover:bg-[#f8f8f8] group-data-[variant=default]/tabs-list:data-active:bg-[#f8f8f8]",
        // line: Workiz's small tabs.
        "group-data-[variant=line]/tabs-list:flex-none group-data-[variant=line]/tabs-list:px-5 group-data-[variant=line]/tabs-list:text-[13px] group-data-[variant=line]/tabs-list:leading-[19px] group-data-[variant=line]/tabs-list:font-medium group-data-[variant=line]/tabs-list:text-wz-slate group-data-[variant=line]/tabs-list:hover:text-foreground group-data-[variant=line]/tabs-list:data-active:font-semibold group-data-[variant=line]/tabs-list:data-active:text-foreground group-data-[variant=line]/tabs-list:data-active:after:h-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        // page: Workiz's big tabs.
        "group-data-[variant=page]/tabs-list:flex-none group-data-[variant=page]/tabs-list:px-[25px] group-data-[variant=page]/tabs-list:text-base group-data-[variant=page]/tabs-list:leading-4 group-data-[variant=page]/tabs-list:font-medium group-data-[variant=page]/tabs-list:text-wz-strong group-data-[variant=page]/tabs-list:after:bg-wz-tab-bar group-data-[variant=page]/tabs-list:data-active:font-semibold group-data-[variant=page]/tabs-list:data-active:after:h-[3px] group-data-[variant=page]/tabs-list:data-active:after:opacity-100",
        // The open tab's bar: on the rule for `line`, just above it for `page`;
        // down the right edge when the tabs stand in a column.
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:-bottom-px group-data-[variant=page]/tabs-list:group-data-horizontal/tabs:after:bottom-0 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-px group-data-vertical/tabs:after:w-0.5 group-data-vertical/tabs:after:h-auto",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
