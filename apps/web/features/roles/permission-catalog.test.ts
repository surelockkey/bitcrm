import { describe, expect, it } from "vitest";
import { RESOURCE_REGISTRY } from "@bitcrm/types";
import { RESOURCE_LABELS, actionLabel, groupedResources, resourceLabel } from "./lib";
import {
  REPORT_TAB_RESOURCES,
  actionSections,
  permissionMatches,
  reportRows,
  resourceDescription,
} from "./permission-catalog";

/**
 * The permission editors read like Workiz's "Edit permissions for role …"
 * (pg_admin_users_wz_10_role_dispatch): every switch has words a person can
 * read — a title, a sentence under it — and nothing lands in an "Other" pile
 * under its raw key. The 2026-10-06 audit found 15 resources and 19 actions
 * printed as `payments`, `team_chat`, `move_status`, `view_jobs_by_status`.
 */

const registry = RESOURCE_REGISTRY as unknown as Record<string, readonly string[]>;
const resources = Object.keys(registry);
const raw = (text: string) => /_/.test(text) || /^[a-z]/.test(text);

describe("every registered permission has readable words", () => {
  it.each(resources)("%s has a label and a description", (resource) => {
    expect(RESOURCE_LABELS[resource], resource).toBeTruthy();
    expect(raw(resourceLabel(resource)), resourceLabel(resource)).toBe(false);
    expect(resourceDescription(resource).length, resource).toBeGreaterThan(10);
  });

  it.each(resources)("%s: every action has a label, not its key", (resource) => {
    for (const action of registry[resource]) {
      const label = actionLabel(action, resource);
      expect(label, `${resource}.${action}`).toBeTruthy();
      expect(raw(label), `${resource}.${action} → ${label}`).toBe(false);
    }
  });

  it("puts every resource in a named group — nothing in 'Other'", () => {
    expect(groupedResources(registry).map((g) => g.label)).not.toContain("Other");
  });
});

describe("the editor's tabs", () => {
  it("Actions holds every resource but the reports and the dashboard, in named sections", () => {
    const sections = actionSections(registry);
    const listed = sections.flatMap((s) => s.resources);
    expect(listed).not.toContain("reports");
    expect(listed).not.toContain("dashboard");
    expect(new Set(listed)).toEqual(new Set(resources.filter((r) => !REPORT_TAB_RESOURCES.includes(r))));
    expect(sections.every((s) => s.label && s.resources.length > 0)).toBe(true);
  });

  it("Reports lists one row per report and widget switch, in Workiz's words", () => {
    const rows = reportRows(registry);
    const titles = rows.map((r) => r.title);
    // Workiz's Reports tab names its statistics grants this way (pg_admin_users_wz_13_tab_reports).
    expect(titles).toContain("Statistics Report: Ad Statistics");
    expect(titles).toContain("Statistics Report: View Profit");
    // Workiz's Dashboard row, word for word.
    expect(rows.find((r) => r.resource === "dashboard" && r.action === "view")).toMatchObject({
      title: "Dashboard",
      description: "View dashboard statistics",
    });
    expect(titles).toContain("Dashboard: Jobs By Status");
    // Every action of both resources, once.
    const want = REPORT_TAB_RESOURCES.flatMap((r) => registry[r].map((a) => `${r}.${a}`));
    expect(rows.map((r) => `${r.resource}.${r.action}`)).toEqual(want);
    expect(rows.every((r) => !raw(r.title) && r.description.length > 5)).toBe(true);
  });

  it("leaves out of the Reports tab what the schema lacks", () => {
    expect(reportRows({ reports: ["view"] })).toEqual([
      expect.objectContaining({ resource: "reports", action: "view", title: "Reports" }),
    ]);
    expect(actionSections({ deals: ["view"], reports: ["view"] })).toEqual([
      { label: "Jobs & clients", resources: ["deals"] },
    ]);
  });
});

describe("Search", () => {
  it("finds a resource by its name, its sentence or a switch's words, any case", () => {
    expect(permissionMatches("payments", "refund")).toBe(true);
    expect(permissionMatches("payments", "PAYMENTS")).toBe(true);
    expect(permissionMatches("contacts", "phone numbers")).toBe(true);
    expect(permissionMatches("deals", "refund")).toBe(false);
  });

  it("an empty search finds everything", () => {
    expect(permissionMatches("deals", "  ")).toBe(true);
  });

  it("finds a report row by its title or sentence", () => {
    expect(permissionMatches("dashboard", "top sources", "view_top_sources")).toBe(true);
    expect(permissionMatches("dashboard", "top sources", "view_sales")).toBe(false);
  });
});
