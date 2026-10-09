"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { contrastRatio } from "@/lib/theme/color";
import { LIGHT } from "@/lib/theme/tokens";

/*
 * Workiz's map pin and its card (ui-components MapPin / MapPinGroup and the
 * map's Marker-module, main.css; captures pg_dispatch_wz_02..13):
 *
 *   pin     a 42×48.5 teardrop (SVG, viewBox "4 1.5 45 52") in the tech's
 *           colour under a 3px white edge, a blurred 14×5 shadow under the
 *           tip, .9 opacity hovered. The tech's initials sit at 45% height,
 *           16px/24px semibold, .2px tracking, white or ink — whichever
 *           stands out more. No tech: #566d76 with the blocked-person glyph.
 *   group   several techs on one job: the first tech's pin, then a slate
 *           "+N" pin 12px under its right edge.
 *   tooltip the MUI dark chip over the pin, 14px above it.
 *   card    339px + 12px padding, 12px corners, 0 4px 16px rgba(0,0,0,.15),
 *           10px above the pin with a 5px white arrow; an 18px semibold title
 *           beside 20px action glyphs 14px apart; 14px/21px rows 12px apart.
 */

/** The pin of a job nobody is on (and the "+N" pin): Workiz's slate. */
export const WZ_UNASSIGNED_PIN = LIGHT.wzSlate;

const PIN_PATH =
  "M26.5 3.5C38.098 3.5 47.5 12.902 47.5 24.5C47.5 33.3926 41.9727 40.9942 34.1663 44.0567L27.6961 50.9007C27.5612 51.0858 27.3821 51.2369 27.1739 51.3412C26.9657 51.4455 26.7346 51.5 26.5 51.5C26.2654 51.5 26.0343 51.4455 25.8261 51.3412C25.6179 51.2369 25.4388 51.0858 25.3039 50.9007L18.8337 44.0567C11.0273 40.9941 5.5 33.3926 5.5 24.5C5.5 12.902 14.902 3.5 26.5 3.5Z";

/**
 * The letters on a tech's pin: the first character of the name's first word
 * and of its last — "(2) CT - Tyler Boucher" → "(B", "Albert IL" → "AI" —
 * read off every pin of the live map.
 */
export function wzPinInitials(name: string | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0][0];
  return words[0][0] + words[words.length - 1][0];
}

/**
 * Whether a pin's letters are ink rather than white: Workiz picks whichever
 * of the two has the higher contrast with the fill (every fill/letter pair on
 * the live map agrees — #5f9ea0 white, #6495ed ink).
 */
export function wzPinInk(fill: string): boolean {
  return contrastRatio(LIGHT.foreground, fill) > contrastRatio("#ffffff", fill);
}

/** Workiz's `wfi-block-caller`: a person beside a slashed ring. */
function BlockedPersonIcon() {
  return (
    <svg
      data-slot="wz-pin-unassigned"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="#ffffff"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      <circle cx="9" cy="6.6" r="3.4" />
      <path d="M3.4 20.2c0-3.9 2.6-7.4 6.2-7.4 1 0 1.8.2 2.6.6" />
      <circle cx="16.6" cy="16.6" r="4.6" />
      <path d="M13.4 19.8l6.4-6.4" />
    </svg>
  );
}

function PinShape({ color, label, ink, glyph }: { color: string; label?: string; ink: boolean; glyph: boolean }) {
  return (
    <span
      data-testid="wz-map-pin"
      className={cn(
        "relative isolate inline-block w-[42px] cursor-pointer leading-0 transition-opacity duration-150 hover:opacity-90",
        // The blurred 14×5 shadow under the tip.
        "after:absolute after:-bottom-0.5 after:left-1/2 after:-z-10 after:h-[5px] after:w-[14px] after:-translate-x-1/2 after:rounded-[50%] after:bg-black/15 after:blur-[1.5px] after:content-['']",
      )}
    >
      <svg viewBox="4 1.5 45 52" aria-hidden focusable="false" className="block h-auto w-full">
        <path d={PIN_PATH} fill={color} stroke="#FFFFFF" strokeWidth="3" paintOrder="stroke fill" />
      </svg>
      <span className="pointer-events-none absolute top-[45%] left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center leading-0 select-none">
        {glyph ? (
          <BlockedPersonIcon />
        ) : (
          <span
            className={cn(
              "text-base leading-6 font-semibold tracking-[0.2px] whitespace-nowrap",
              ink ? "text-foreground" : "text-white",
            )}
          >
            {label}
          </span>
        )}
      </span>
    </span>
  );
}

export interface WzMapPinProps {
  /** The tech's colour; none draws the slate "Unassigned" pin. */
  color?: string;
  /** The letters on it (`wzPinInitials(name)`). */
  label?: string;
  /** Whose pin it is — the tooltip's words ("Unassigned" for nobody). */
  name: string;
  /** Further techs on the same job: a "+N" pin behind the first. */
  more?: number;
  /** Show the name over the pin (hovered). */
  tooltip?: boolean;
  /** A guess rather than a measurement (a tech placed by home / last job). */
  dim?: boolean;
  className?: string;
  /** Hangs over the pin — a `WzMapPinCard`. */
  children?: ReactNode;
}

/**
 * A Workiz map pin, bottom-centre on its spot (put it in an AdvancedMarker,
 * whose default anchor is the content's bottom centre).
 */
export function WzMapPin({ color, label, name, more = 0, tooltip = false, dim = false, className, children }: WzMapPinProps) {
  const fill = color ?? WZ_UNASSIGNED_PIN;
  return (
    <span
      data-slot="wz-map-pin"
      aria-label={name}
      className={cn("relative inline-flex items-start", className)}
    >
      <span className={cn("relative z-[1]", dim && "opacity-60")}>
        <PinShape color={fill} label={label} ink={wzPinInk(fill)} glyph={!color} />
      </span>
      {more > 0 ? (
        <span className={cn("relative z-0 -ml-3", dim && "opacity-60")}>
          <PinShape color={WZ_UNASSIGNED_PIN} label={`+${more}`} ink={false} glyph={false} />
        </span>
      ) : null}
      {tooltip ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-[calc(100%+14px)] left-[21px] z-20 -translate-x-1/2 rounded-[4px] bg-foreground px-3 py-2 text-xs leading-[18px] font-medium tracking-[0.4px] whitespace-nowrap text-white shadow-[0_0_4px_rgba(59,75,82,0.05),0_4px_12px_rgba(59,75,82,0.1)]"
        >
          {name}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export interface WzMapPinCardAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

/**
 * The card a pin opens (Marker-module cardWrapper): put it inside `WzMapPin`
 * and it hangs 10px over the pin, centred on it.
 */
export function WzMapPinCard({
  title,
  actions = [],
  onClose,
  className,
  children,
}: {
  title: ReactNode;
  /** Glyphs before the × ("Edit", "View"). */
  actions?: WzMapPinCardAction[];
  onClose: () => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="wz-map-pin-card"
      role="dialog"
      aria-label={typeof title === "string" ? title : undefined}
      className={cn(
        "absolute bottom-[calc(100%+10px)] left-[21px] z-30 w-[363px] -translate-x-1/2 cursor-default rounded-[12px] bg-white p-3 text-left leading-normal tracking-[0.4px] shadow-[0_4px_16px_rgba(0,0,0,0.15)]",
        // The 5px arrow down to the pin.
        "after:absolute after:top-full after:left-1/2 after:-ml-[5px] after:border-[5px] after:border-transparent after:border-t-white after:content-['']",
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2 text-[18px] leading-[21px] font-semibold text-foreground">
        <span className="flex min-w-0 flex-wrap items-center gap-2 break-words">{title}</span>
        <span className="flex shrink-0 items-center gap-[14px] pl-[14px]">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              aria-label={a.label}
              title={a.label}
              onClick={a.onClick}
              className="flex size-5 cursor-pointer items-center justify-center text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-5"
            >
              {a.icon}
            </button>
          ))}
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="flex size-5 cursor-pointer items-center justify-center text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-5" strokeWidth={1.6} />
          </button>
        </span>
      </div>
      <div className="flex max-h-[360px] flex-col gap-3 overflow-y-auto text-sm leading-[21px] text-foreground">{children}</div>
    </div>
  );
}

/**
 * One line of the card (Marker-module markerWrap > *): a 20px glyph 8px before
 * the words, something at the right, and the rule under the phone line.
 */
export function WzMapPinCardRow({
  icon,
  end,
  rule = false,
  className,
  children,
}: {
  icon?: ReactNode;
  end?: ReactNode;
  rule?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", rule && "border-b border-border pb-3", className)}>
      <div className="flex min-w-0 items-center">
        {icon ? <span className="mr-2 flex shrink-0 [&_svg]:size-5">{icon}</span> : null}
        <span className="min-w-0 break-words">{children}</span>
      </div>
      {end ? <div className="flex shrink-0 items-center">{end}</div> : null}
    </div>
  );
}
