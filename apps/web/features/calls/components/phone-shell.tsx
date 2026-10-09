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

/**
 * The heading with the number pill (callspage_wz_01: "Workiz Phone" +
 * "(203) 403-6303"). Before the number is known — and when there is none —
 * the pill's 36px beside the 32px title is held, so the strip and the grid
 * under it never move for it (app_audit 2026-10-09, finding 15: 4px).
 */
export function PhoneHeader({ number }: { number?: string }) {
  return (
    <WzPageHeader
      title={PHONE_TITLE}
      pill={
        number ? (
          <WzHeaderPill icon={<Phone className="size-3.5 fill-current" strokeWidth={0} aria-hidden />}>
            {formatPhone(number) || number}
          </WzHeaderPill>
        ) : (
          <span aria-hidden data-testid="phone-header-pill-place" className="block h-9 w-0" />
        )
      }
    />
  );
}

/**
 * The tab strip: the tabs this viewer may open, the current route marked.
 * While the permissions load every tab holds its place as a placeholder —
 * an empty strip that filled in later pushed the whole page down 46px
 * (app_audit 2026-10-09, finding 15).
 */
export function PhoneTabs() {
  const pathname = usePathname() ?? "/calls";
  const { can, isLoading } = usePermissions();
  const waiting = !!isLoading;
  return (
    <WzTabLinks
      label="Phone"
      tabs={phoneTabs((r, a) => waiting || can(r, a ?? "view"))}
      active={activePhoneTab(pathname)}
      pending={waiting}
    />
  );
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
