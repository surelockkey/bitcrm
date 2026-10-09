import type { Action, Resource } from "@bitcrm/types";

/**
 * The tab strip under the Phone header — Workiz's eight (callspage_wz_tab_*)
 * less the two we have no page for (Call masking, Devices). The settings
 * tabs are the settings pages themselves, drawn under the same header at
 * Workiz's sub-routes (`/root/callsReport/numbers` …); Blocked callers is
 * Workiz's `/root/callsReport/blocked-callers`.
 */
export type PhoneTabId = "calls" | "numbers" | "flows" | "groups" | "blocked" | "texting";

export interface PhoneTab {
  id: PhoneTabId;
  label: string;
  href: string;
}

/** What opens a tab: a resource's `view`, or a named action on it. */
type PhoneGrant = { resource: Resource; action?: Action };

const TABS: (PhoneTab & PhoneGrant)[] = [
  { id: "calls", label: "Calls", href: "/calls", resource: "calls" },
  { id: "numbers", label: "Phone numbers", href: "/calls/numbers", resource: "settings" },
  { id: "flows", label: "Call flows", href: "/calls/flows", resource: "settings" },
  { id: "groups", label: "Call groups", href: "/calls/groups", resource: "settings" },
  // Workiz Phone → Blocked callers: the office's list, behind `calls.block`
  // (a technician never sees it; a dispatcher who blocks spam does).
  { id: "blocked", label: "Blocked callers", href: "/calls/blocked-callers", resource: "calls", action: "block" },
  { id: "texting", label: "Texting", href: "/calls/texting", resource: "settings" },
];

/**
 * The tabs this viewer may open, in Workiz's order. `can` is asked with the
 * tab's resource and, for a tab behind a named action, that action (absent
 * means the resource's `view`).
 */
export function phoneTabs(can: (resource: Resource, action?: Action) => boolean): PhoneTab[] {
  return TABS.filter((t) => can(t.resource, t.action)).map(({ id, label, href }) => ({ id, label, href }));
}

/** Which tab a path is, or null off the strip (a single call's page). */
export function activePhoneTab(pathname: string): PhoneTabId | null {
  return TABS.find((t) => t.href === pathname.replace(/\/+$/, ""))?.id ?? null;
}
