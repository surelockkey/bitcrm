import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Workiz's Tag (Tag-module): a 19px chip, 4px corners, 4px either side,
 * 13px/19px white words. The Map paints a job's status `success` green
 * whatever the status is (every tag on pg_dispatch_wz_02 is #3acf7d);
 * `archived` (#9ea6aa) and `primary` (#3589e9) are the module's other
 * fills, used here for our Sent / Seen stamps.
 */
const TONE = {
  success: "bg-wz-tag-success",
  archived: "bg-wz-outline",
  primary: "bg-brand",
} as const;

export function MapTag({
  tone = "success",
  bold = false,
  title,
  className,
  children,
}: {
  tone?: keyof typeof TONE;
  /** The list card's tags read semibold (its `:first-child` rule); the pin card's don't. */
  bold?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-[4px] px-1 text-[13px] leading-[19px] tracking-[0.4px] text-white",
        bold ? "font-semibold" : "font-normal",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
