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
    expect(labelsOf("General Settings")).toEqual(["Companies", "Automations", "Documents"]);
    expect(labelsOf("Users & Roles")).toEqual(["Users", "Roles"]);
    expect(labelsOf("Job Settings")).toEqual([
      "Service Areas",
      "Job Types",
      "External Companies",
      "Job Sources",
      "Job Fields",
      "Custom Fields",
      "Job Statuses",
      "Job Tags",
      "Client Tags",
    ]);
    expect(labelsOf("Calls & Text")).toEqual([
      "Messaging",
      "Message Templates",
      "Phone Numbers",
      "Call Flows",
      "Call Groups",
      "Call Tags",
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
    // These two only redirect old bookmarks: to the module, and to the settings screen.
    const redirects = ["/settings/automations", "/settings/general"];
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
    expect(groups[0].sections.map((s) => s.label)).toEqual(["Users"]);
  });
});
