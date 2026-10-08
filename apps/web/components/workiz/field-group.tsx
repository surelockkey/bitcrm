"use client";

import { Children, createContext, isValidElement, useContext, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * How neighbouring fields in a {@link WzFieldGroup} meet.
 *
 * - `seamless` — one box, no line between: New Job "Phone | Ext" and
 *   "Address | Unit" (new_01_empty). Workiz lays the second input 2px over the
 *   first with no left border, so its white fill hides the first one's right
 *   edge; this does the same, focus states included.
 * - `line` — the two share a single 1px #ccc edge: the job page's
 *   "First Name | Last Name" (job_b_01_details).
 * - `soft` — a 1px #cad3d6 divider that stays put while either side is
 *   focused: the job page's "Phone | Ext".
 */
export type WzJoin = "seamless" | "line" | "soft";

export interface WzGroupSlot {
  join: WzJoin;
  first: boolean;
  last: boolean;
}

const GroupSlotContext = createContext<WzGroupSlot | null>(null);

/** Where the calling field sits in a {@link WzFieldGroup}, or null outside one. */
export function useGroupSlot(): WzGroupSlot | null {
  return useContext(GroupSlotContext);
}

/** Wrapper classes for a field that is not first in its group. */
const JOIN_WRAPPER: Record<WzJoin, string> = {
  seamless: "-ml-0.5",
  line: "-ml-px",
  soft: "-ml-px",
};

/** Edge classes for that field's own box. */
const JOIN_BOX: Record<WzJoin, string> = {
  seamless: "border-l-0 focus:border-l-0",
  line: "",
  soft: "border-l-wz-rule focus:border-l-wz-rule",
};

export function groupWrapperClass(slot: WzGroupSlot | null): string | undefined {
  return slot && !slot.first ? JOIN_WRAPPER[slot.join] : undefined;
}

export function groupBoxClass(slot: WzGroupSlot | null): string | undefined {
  return slot && !slot.first ? JOIN_BOX[slot.join] || undefined : undefined;
}

/**
 * A row of fields drawn as one control. Give each child its width through
 * its own `className` (e.g. `className="w-[100px] flex-none"` on Ext); the
 * rest share what is left.
 */
export function WzFieldGroup({
  join = "line",
  className,
  children,
}: {
  join?: WzJoin;
  className?: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <div data-slot="wz-field-group" data-join={join} className={cn("flex items-start", className)}>
      {items.map((child, i) => (
        <GroupSlotContext.Provider
          key={child.key ?? i}
          value={{ join, first: i === 0, last: i === items.length - 1 }}
        >
          {child}
        </GroupSlotContext.Provider>
      ))}
    </div>
  );
}
