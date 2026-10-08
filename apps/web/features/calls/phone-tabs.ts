import type { Resource } from "@bitcrm/types";

/**
 * The tab strip under the Phone header — Workiz's eight (callspage_wz_tab_*)
 * less the three we have no page for (Call masking, Blocked callers,
 * Devices). The settings tabs are the settings pages themselves, drawn under
 * the same header at Workiz's sub-routes (`/root/callsReport/numbers` …).
 */
export type PhoneTabId = "calls" | "numbers" | "flows" | "groups" | "texting";

export interface PhoneTab {
  id: PhoneTabId;
  label: string;
  href: string;
}

const TABS: (PhoneTab & { resource: Resource })[] = [
  { id: "calls", label: "Calls", href: "/calls", resource: "calls" },
  { id: "numbers", label: "Phone numbers", href: "/calls/numbers", resource: "settings" },
  { id: "flows", label: "Call flows", href: "/calls/flows", resource: "settings" },
  { id: "groups", label: "Call groups", href: "/calls/groups", resource: "settings" },
  { id: "texting", label: "Texting", href: "/calls/texting", resource: "settings" },
];

/** The tabs this viewer may open, in Workiz's order. */
export function phoneTabs(can: (resource: Resource) => boolean): PhoneTab[] {
  return TABS.filter((t) => can(t.resource)).map(({ id, label, href }) => ({ id, label, href }));
}

/** Which tab a path is, or null off the strip (a single call's page). */
export function activePhoneTab(pathname: string): PhoneTabId | null {
  return TABS.find((t) => t.href === pathname.replace(/\/+$/, ""))?.id ?? null;
}
