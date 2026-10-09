import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Resource } from "@bitcrm/types";
import { SETTINGS_GROUPS, settingsFrame, visibleSettingsGroups } from "./sections";

/**
 * Workiz's settings pages carry their own frame (the grey band, full width)
 * and have no settings rail. A page rebuilt that way draws itself edge to
 * edge; one not rebuilt yet keeps the old frame — the "Settings" heading and
 * the rail — until its own rebuild lands.
 */
describe("settingsFrame", () => {
  it("leaves the settings home and the rebuilt catalogs to draw themselves", () => {
    for (const href of [
      "/settings",
      "/settings/job-types",
      "/settings/job-sources",
      "/settings/job-statuses",
      "/settings/job-tags",
      "/settings/client-tags",
      "/settings/custom-fields",
      "/settings/job-fields",
      "/settings/service-areas",
      "/settings/external-companies",
      "/settings/call-tags",
      "/settings/companies",
      "/settings/documents",
      "/settings/payments",
      "/settings/preferences",
    ]) {
      expect(settingsFrame(href), href).toBe("workiz");
    }
  });

  it("gives the template editor the whole content area, bounded, as Workiz's sits in its shell", () => {
    expect(settingsFrame("/settings/documents/tpl-default-invoice")).toBe("editor");
    expect(settingsFrame("/settings/documents/abc/")).toBe("editor");
  });

  it("keeps the old frame round a page not rebuilt yet", () => {
    expect(settingsFrame("/settings/messaging")).toBe("rail");
    expect(settingsFrame("/settings/documents/abc/more")).toBe("rail");
  });

  it("ignores a trailing slash", () => {
    expect(settingsFrame("/settings/job-types/")).toBe("workiz");
  });
});

/**
 * Settings come in blocks, Workiz's: its settings page is not one long list
 * but General Settings, Users & Roles, Job Settings, Calls & Text and
 * Integrations, each a heading over its own tiles. Twenty sections in a row
 * read as a wall; grouped, an office manager trained on Workiz finds Call
 * Flows where they left it.
 */
describe("SETTINGS_GROUPS", () => {
  it("are Workiz's blocks, in Workiz's order", () => {
    expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual([
      "General Settings",
      "Users & Roles",
      "Job Settings",
      "Calls & Text",
      "Integrations",
    ]);
  });

  it("file each section under the block Workiz keeps it in", () => {
    const labelsOf = (group: string) => SETTINGS_GROUPS.find((g) => g.label === group)?.sections.map((s) => s.label);
    // General is the settings screen itself (the rail's first link), not a tile on it.
    // The tiles carry Workiz's names where the thing is the same
    // (app_audit_wz_settings, 2026-10-09): Automation Center, Team Management,
    // Roles & Permissions, Ad Groups (job sources), Field Validation (required
    // job fields), Sub-Status (job statuses) — the routes stay ours.
    // Account Preferences: Workiz's Account → Preferences toggles (Update Job End Time), reached from the settings home here.
    expect(labelsOf("General Settings")).toEqual(["Companies", "Automation Center", "Documents", "Account Preferences"]);
    expect(labelsOf("Users & Roles")).toEqual(["Team Management", "Roles & Permissions"]);
    expect(labelsOf("Job Settings")).toEqual([
      "Service Areas",
      "Job Types",
      "External Companies",
      "Ad Groups",
      "Field Validation",
      "Custom Fields",
      "Sub-Status",
      "Job Tags",
      "Client Tags",
    ]);
    const hrefOfLabel = (label: string) => SETTINGS_GROUPS.flatMap((g) => g.sections).find((s) => s.label === label)?.href;
    expect(["Automation Center", "Team Management", "Roles & Permissions", "Ad Groups", "Field Validation", "Sub-Status"].map(hrefOfLabel)).toEqual([
      "/automations",
      "/admin/users",
      "/admin/roles",
      "/settings/job-sources",
      "/settings/job-fields",
      "/settings/job-statuses",
    ]);
    // Workiz's tiles, words and order (uikit_wz_settings_home): Text Messages,
    // Numbers, Call Flows, Call Groups (+ its Call Masking and Devices, which
    // we have no page for), then ours, Call Tags. Message templates have no
    // tile: they sit on Text Messages, under "Text templates".
    expect(labelsOf("Calls & Text")).toEqual(["Text Messages", "Numbers", "Call Flows", "Call Groups", "Call Tags"]);
    // …and open the Phone section's tabs, as Workiz's /root/numbers lands on /root/callsReport/numbers.
    const hrefOf = (label: string) => SETTINGS_GROUPS.flatMap((g) => g.sections).find((s) => s.label === label)?.href;
    expect(["Text Messages", "Numbers", "Call Flows", "Call Groups"].map(hrefOf)).toEqual([
      "/calls/texting",
      "/calls/numbers",
      "/calls/flows",
      "/calls/groups",
    ]);
    expect(labelsOf("Integrations")).toEqual(["Payments"]);
  });

  it("list every section once", () => {
    const hrefs = SETTINGS_GROUPS.flatMap((g) => g.sections.map((s) => s.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("leave no settings page out of every block", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const pages = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, "page.tsx")))
      .map((e) => `/settings/${e.name}`);
    // These only redirect old bookmarks: to the module, to the settings screen,
    // and to the Phone section's tabs (where Workiz keeps its phone settings).
    const redirects = [
      "/settings/automations",
      "/settings/general",
      "/settings/phone-numbers",
      "/settings/call-flows",
      "/settings/call-groups",
      "/settings/messaging",
      "/settings/message-templates",
    ];
    const listed = [...SETTINGS_GROUPS.flatMap((g) => g.sections.map((s) => s.href)), ...redirects];
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.filter((p) => !listed.includes(p))).toEqual([]);
  });
});

describe("visibleSettingsGroups", () => {
  it("keeps every block for whoever may open everything", () => {
    expect(visibleSettingsGroups(() => true)).toEqual(SETTINGS_GROUPS);
  });

  it("leaves out the sections the reader may not open", () => {
    const can = (r: Resource) => r !== "job_tags" && r !== "client_tags";
    const job = visibleSettingsGroups(can).find((g) => g.label === "Job Settings")!;
    expect(job.sections.map((s) => s.label)).not.toContain("Job Tags");
    expect(job.sections.map((s) => s.label)).not.toContain("Client Tags");
    expect(job.sections.map((s) => s.label)).toContain("Job Types");
  });

  it("drops a block left with nothing in it, rather than draw a bare heading", () => {
    const groups = visibleSettingsGroups((r) => r === "users");
    expect(groups.map((g) => g.label)).toEqual(["Users & Roles"]);
    expect(groups[0].sections.map((s) => s.label)).toEqual(["Team Management"]);
  });
});
