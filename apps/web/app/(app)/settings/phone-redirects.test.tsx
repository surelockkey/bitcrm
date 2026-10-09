import { describe, expect, it, vi, beforeEach } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

/**
 * Workiz keeps its phone settings in the Phone section, not in Settings: its
 * settings tiles link /root/numbers, /root/flows, /root/ct_groups and
 * /root/sms_settings, and each lands on a tab of /root/callsReport/
 * (data/discovery/settings_phone.md). Ours do the same — the pages live on
 * the /calls tabs, and the old settings addresses send bookmarks there.
 */
describe("the phone settings' old addresses", () => {
  beforeEach(() => redirect.mockReset());

  it.each([
    ["phone-numbers", "/calls/numbers"],
    ["call-flows", "/calls/flows"],
    ["call-groups", "/calls/groups"],
    ["messaging", "/calls/texting"],
    // Message templates are Workiz's "Text templates", on the Text Messages tab.
    ["message-templates", "/calls/texting"],
  ])("/settings/%s lands on %s", async (route, to) => {
    const { default: Page } = await import(`./${route}/page.tsx`);
    Page();
    expect(redirect).toHaveBeenCalledWith(to);
  });
});
