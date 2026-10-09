"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Phone } from "lucide-react";
import { WzHeaderPill, WzPageHeader, WzTabLinks } from "@/components/workiz/page-parts";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useMainNumber } from "../main-number";
import { activePhoneTab, phoneTabs } from "../phone-tabs";

/**
 * Workiz's "Workiz Phone" section, ours: the same heading, number pill and
 * tab strip over the call log and the four telephony settings pages.
 */
export const PHONE_TITLE = "BitCRM Phone";

/** The heading with the number pill (callspage_wz_01: "Workiz Phone" + "(203) 403-6303"). */
export function PhoneHeader({ number }: { number?: string }) {
  return (
    <WzPageHeader
      title={PHONE_TITLE}
      pill={
        number ? (
          <WzHeaderPill icon={<Phone className="size-3.5 fill-current" strokeWidth={0} aria-hidden />}>
            {formatPhone(number) || number}
          </WzHeaderPill>
        ) : null
      }
    />
  );
}

/** The tab strip: the tabs this viewer may open, the current route marked. */
export function PhoneTabs() {
  const pathname = usePathname() ?? "/calls";
  const { can } = usePermissions();
  return <WzTabLinks label="Phone" tabs={phoneTabs((r) => can(r))} active={activePhoneTab(pathname)} />;
}

/**
 * A settings page drawn as one of the section's tabs (`/calls/numbers`, …):
 * the heading and the strip over the page, which keeps its own skeleton and
 * permission checks. The page mounts at once (its requests start), but is
 * shown in the same frame as the number pill, so the pill never pops in
 * beside a page already up.
 */
export function PhoneTabPage({ children }: { children: ReactNode }) {
  const { number, settled } = useMainNumber();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <PhoneHeader number={settled ? number : undefined} />
      <PhoneTabs />
      {/* Edge to edge: each tab draws Workiz's own insets (its words 40px
          in, the strip and the grid the full width — pg_settings_phone_wz_*). */}
      <div className={cn("flex flex-1 flex-col", !settled && "invisible")}>{children}</div>
    </div>
  );
}
