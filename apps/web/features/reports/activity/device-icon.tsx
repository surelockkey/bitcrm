"use client";

import type { ActivitySource } from "@bitcrm/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/*
 * Workiz's device marks after the action (`activity-moule__deviceIcon`, the
 * Linearicons font): `lnr-laptop-phone` "Web App", `lnr-smartphone` "Mobile
 * App". Traced off rep_activity_wz_06_yesterday / _11_user_filtered: 1px ink
 * strokes in an 18px box, 20px after the words — the laptop 18×15 with the
 * phone over its right side, the phone 11×19 with a speaker and a home dot.
 * The dark MUI chip names it under the cursor (rep_activity_wz_03b).
 */
function LaptopPhoneGlyph() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1} aria-hidden className="size-[18px]">
      <path d="M2.5 12.5v-10h13v3.5" />
      <path d="M.5 13.5h11v2H.5z" />
      <rect x="12.5" y="6.5" width="5" height="10" />
      <path d="M14.5 14.5h1" />
    </svg>
  );
}

function SmartphoneGlyph() {
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1} aria-hidden className="size-[18px]">
      <rect x=".5" y=".5" width="10" height="17.5" />
      <path d="M4.5 2.5h2" />
      <path d="M5 15.5h1" />
    </svg>
  );
}

/** The mark for where an action was taken; nothing for a system one. */
export function ActivityDeviceIcon({ source }: { source?: ActivitySource }) {
  if (source !== "web" && source !== "mobile") return null;
  const label = source === "mobile" ? "Mobile App" : "Web App";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} className="ml-5 inline-flex shrink-0 text-foreground">
          {source === "mobile" ? <SmartphoneGlyph /> : <LaptopPhoneGlyph />}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
