import { describe, expect, it } from "vitest";
import { activePhoneTab, phoneTabs } from "./phone-tabs";

/**
 * The tab strip under the Phone header. Workiz has eight (callspage_wz_tab_*):
 * Calls, Phone numbers, Call flows, Call masking, Call groups, Blocked callers,
 * Devices, Texting. We have pages for six of them — the call log, four
 * telephony settings and Devices — and draw only those, at Workiz's sub-routes.
 */
const everything = () => true;

describe("phoneTabs", () => {
  it("lists the tabs we have, in Workiz's order, at Workiz's paths", () => {
    expect(phoneTabs(everything)).toEqual([
      { id: "calls", label: "Calls", href: "/calls" },
      { id: "numbers", label: "Phone numbers", href: "/calls/numbers" },
      { id: "flows", label: "Call flows", href: "/calls/flows" },
      { id: "groups", label: "Call groups", href: "/calls/groups" },
      { id: "devices", label: "Devices", href: "/calls/devices" },
      { id: "texting", label: "Texting", href: "/calls/texting" },
    ]);
  });

  it("keeps the settings tabs from a viewer without settings.view", () => {
    const callsOnly = (resource: string) => resource === "calls";
    expect(phoneTabs(callsOnly).map((t) => t.id)).toEqual(["calls"]);
  });

  it("keeps the call log from a viewer without calls.view", () => {
    const settingsOnly = (resource: string) => resource === "settings";
    expect(phoneTabs(settingsOnly).map((t) => t.id)).toEqual(["numbers", "flows", "groups", "devices", "texting"]);
  });
});

describe("activePhoneTab", () => {
  it.each([
    ["/calls", "calls"],
    ["/calls/numbers", "numbers"],
    ["/calls/flows", "flows"],
    ["/calls/groups", "groups"],
    ["/calls/devices", "devices"],
    ["/calls/texting", "texting"],
  ])("%s is the %s tab", (path, id) => {
    expect(activePhoneTab(path)).toBe(id);
  });

  it("is none on a single call's page", () => {
    expect(activePhoneTab("/calls/CA123")).toBeNull();
  });
});
