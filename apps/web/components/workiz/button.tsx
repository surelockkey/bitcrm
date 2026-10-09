"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * Workiz's ui-components Button (Button-module, main.css), as on the New Job
 * bar ("Create"), the job page bar ("Save"), "Send" and "View schedule":
 *
 *   primary    #fad400, #eac300 hovered, #dcb802 pressed; no border.
 *   secondary  transparent with a 1px ink edge; #f3f6f7 hovered, #c8ced0 pressed.
 *   tertiary   secondary without the edge.
 *   big        10.5px 20px padding (24px with an icon) → 40px tall.
 *   regular    6.5px 12px → 32px (34px with the secondary's edge).
 *   text       13px/19px semibold ink, 0.2px tracking, 4px either side.
 *   icon       19px box (24px on big), 4px gap.
 *
 * Their corners are 20px / 24px, which on these heights is a full round —
 * so `rounded-pill`, per lib/theme/pill-shape.test.ts.
 */

const VARIANT = {
  primary: "border-0 bg-primary hover:bg-wz-primary-hover active:bg-wz-primary-active",
  secondary: "border border-foreground bg-transparent hover:bg-wz-secondary-hover active:bg-wz-secondary-active",
  tertiary: "border-0 bg-transparent hover:bg-wz-secondary-hover active:bg-wz-secondary-active",
} as const;

const SIZE = {
  big: "max-h-10 px-5 py-[10.5px] has-[[data-slot=wz-button-icon]]:px-6",
  regular: "max-h-10 px-3 py-[6.5px]",
} as const;

export interface WzButtonProps extends ComponentProps<"button"> {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  /** An icon before the words ("View schedule" has a calendar). */
  icon?: ReactNode;
  /** Busy: the words hide (the button keeps its width) under a spinner. */
  loading?: boolean;
}

/**
 * A Workiz pill button. The bottom bar's Create is
 * `<WzButton size="big" className="min-w-[150px]">Create</WzButton>`; the job
 * page's Save is the same at `min-w-[200px]`.
 */
export function WzButton({
  variant = "primary",
  size = "big",
  icon,
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...rest
}: WzButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-slot="wz-button"
      data-variant={variant}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer flex-row items-center justify-center gap-1 rounded-pill outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {icon ? (
        <span
          data-slot="wz-button-icon"
          className={cn(
            "relative flex items-center justify-center text-foreground [&_svg]:shrink-0",
            size === "big" ? "size-6 text-[18px] [&_svg]:size-[18px]" : "size-[19px] text-[13px] [&_svg]:size-[15px]",
            loading && "invisible",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span
        className={cn(
          "flex items-center px-1 text-[13px] leading-[19px] font-semibold tracking-[0.2px] whitespace-nowrap text-foreground",
          loading && "invisible",
        )}
      >
        {children}
      </span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center text-foreground">
          <Loader2 className="size-[19px] animate-spin" aria-hidden />
        </span>
      ) : null}
    </button>
  );
}

/**
 * WzButton's look on a link (a Next `Link`): the estimate page's "Price book"
 * and "Create new job" (pg_estimate_wz_01_job), which go somewhere rather
 * than act. Same variants, sizes, icon slot and words as `WzButton`.
 */
export function WzButtonLink({
  variant = "primary",
  size = "big",
  icon,
  className,
  children,
  ...rest
}: Omit<ComponentProps<typeof Link>, "children"> & {
  variant?: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      {...rest}
      data-slot="wz-button"
      data-variant={variant}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer flex-row items-center justify-center gap-1 rounded-pill outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-wz-focus",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {icon ? (
        <span
          data-slot="wz-button-icon"
          className={cn(
            "relative flex items-center justify-center text-foreground [&_svg]:shrink-0",
            size === "big" ? "size-6 text-[18px] [&_svg]:size-[18px]" : "size-[19px] text-[13px] [&_svg]:size-[15px]",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex items-center px-1 text-[13px] leading-[19px] font-semibold tracking-[0.2px] whitespace-nowrap text-foreground">
        {children}
      </span>
    </Link>
  );
}

const LINK = {
  /** "Set recurring schedule": 14px regular #6aa8ee, underlined. */
  blue: "text-[14px] leading-4 font-normal text-wz-link underline",
  /** New Job "Add phone": 12px semibold #404040, 5px under the box. */
  bold: "text-[12px] leading-4 font-semibold text-wz-strong",
  /** Job page "Add Phone": 12px medium #404040, underlined, pulled 5px up. */
  underlined: "text-[12px] leading-4 font-medium text-wz-strong underline",
} as const;

type WzLinkProps = (ComponentProps<"button"> & { href?: undefined }) | (ComponentProps<"a"> & { href: string });

/**
 * Text that acts: a <button> by default, an <a> when given an href.
 * `tone`: "blue" (Set recurring schedule), "bold" (Add phone), "underlined"
 * (the job page's Add Phone).
 */
export function WzLink({ tone = "blue", className, ...props }: WzLinkProps & { tone?: keyof typeof LINK }) {
  const cls = cn(
    "inline-block cursor-pointer bg-transparent p-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-wz-focus",
    LINK[tone],
    className,
  );
  if (typeof props.href === "string") {
    return <a data-slot="wz-link" className={cls} {...(props as ComponentProps<"a">)} />;
  }
  const { type = "button", ...rest } = props as ComponentProps<"button">;
  return <button data-slot="wz-link" type={type} className={cls} {...rest} />;
}
