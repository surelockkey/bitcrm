import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RESOURCE_REGISTRY } from "@bitcrm/types";
import { RESOURCE_LABELS, actionLabel, groupedResources, resourceLabel } from "./lib";
import {
  REPORT_TAB_RESOURCES,
  UNUSED_PERMISSIONS,
  actionSections,
  isShownPermission,
  permissionMatches,
  permissionWords,
  reportRows,
  resourceDescription,
} from "./permission-catalog";

/**
 * The permission editors read like Workiz's "Edit permissions for role …"
 * (pg_admin_users_wz_10_role_dispatch): one green switch per row, each row a
 * bold title over a sentence saying what it lets a person do — and nothing
 * left as a raw key in an "Other" pile (the 2026-10-06 audit found 15
 * resources and 19 actions printed as `payments`, `move_status`, …).
 */

const registry = RESOURCE_REGISTRY as unknown as Record<string, readonly string[]>;
const resources = Object.keys(registry);
const pairs = resources.flatMap((r) => registry[r].map((a) => [r, a] as const));
const shown = pairs.filter(([r, a]) => isShownPermission(r, a));
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
      expect(raw(label), `${resource}.${action} → ${label}`).toBe(false);
    }
  });

  it("every switch shown has its own row title and a sentence — no two rows alike", () => {
    const titles = shown.map(([r, a]) => permissionWords(r, a).title);
    for (const [r, a] of shown) {
      const w = permissionWords(r, a);
      expect(raw(w.title), `${r}.${a} → ${w.title}`).toBe(false);
      expect(w.description.length, `${r}.${a}`).toBeGreaterThan(8);
    }
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([]);
  });

  it("uses Workiz's own words where the switch is the same thing", () => {
    expect(permissionWords("deals", "create")).toEqual({ title: "Add Jobs", description: "Schedule new jobs" });
    expect(permissionWords("messages", "view")).toEqual({ title: "Messaging", description: "View the messages inbox" });
    expect(permissionWords("dashboard", "view")).toEqual({ title: "Dashboard", description: "View dashboard statistics" });
    expect(permissionWords("reports", "view_ad_statistics").title).toBe("Statistics Report: Ad Statistics");
    expect(permissionWords("products", "view").title).toBe("Pricebook Access");
  });

  it("puts every resource in a named group — nothing in 'Other'", () => {
    expect(groupedResources(registry).map((g) => g.label)).not.toContain("Other");
  });
});

describe("switches nothing reads", () => {
  /**
   * Hidden from the editors — their stored values are kept, they just are not
   * offered, because flipping them changes nothing (checklist:
   * workiz-data-parser/docs/import/app-parity-2026-10-08/permissions_completeness.md).
   */
  it("are registry actions", () => {
    for (const key of UNUSED_PERMISSIONS) {
      const [r, a] = key.split(".");
      expect(registry[r], key).toContain(a);
      expect(isShownPermission(r, a)).toBe(false);
    }
  });

  it("are read nowhere in the code — the day one is wired, it must come back to the editors", () => {
    const root = join(__dirname, "../../../..");
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", "dist", ".next", "test", "coverage"].includes(name)) continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) sources.push(readFileSync(p, "utf8"));
      }
    };
    for (const service of readdirSync(join(root, "backend/services"))) {
      const src = join(root, "backend/services", service, "src");
      try {
        if (statSync(src).isDirectory()) walk(src);
      } catch {
        // a service without src
      }
    }
    for (const dir of ["app", "features", "components", "lib"]) walk(join(root, "apps/web", dir));
    for (const key of UNUSED_PERMISSIONS) {
      const [r, a] = key.split(".");
      const check = new RegExp(
        `(RequirePermission|hasPermission[^)]*?|\\bcan|\\bdenied)\\(\\s*(?:[\\w.?]+,\\s*)?['"]${r}['"]\\s*,\\s*['"]${a}['"]|\\[\\s*['"]${r}['"]\\s*,\\s*['"]${a}['"]\\s*\\]|permissions\\??\\.${r}\\??\\.${a}\\b`,
      );
      expect(sources.some((s) => check.test(s)), `${key} is checked somewhere — show it again`).toBe(false);
    }
  });
});

describe("the editor's tabs", () => {
  it("Actions holds every resource but the reports and the dashboard, in named sections, a row per shown switch", () => {
    const sections = actionSections(registry);
    const listed = sections.flatMap((s) => s.resources.map((r) => r.resource));
    expect(listed).not.toContain("reports");
    expect(listed).not.toContain("dashboard");
    expect(new Set(listed)).toEqual(new Set(resources.filter((r) => !REPORT_TAB_RESOURCES.includes(r))));
    const rows = sections.flatMap((s) => s.resources.flatMap((r) => r.actions.map((a) => `${r.resource}.${a}`)));
    expect(rows).toContain("deals.move_status");
    expect(rows).not.toContain("transfers.delete");
    expect(sections.every((s) => s.label && s.resources.length > 0)).toBe(true);
  });

  it("Reports lists one row per report and widget switch, in Workiz's words", () => {
    const rows = reportRows(registry);
    const titles = rows.map((r) => r.title);
    expect(titles).toContain("Statistics Report: Ad Statistics");
    expect(titles).toContain("Statistics Report: View Profit");
    expect(rows.find((r) => r.resource === "dashboard" && r.action === "view")).toMatchObject({
      title: "Dashboard",
      description: "View dashboard statistics",
    });
    expect(titles).toContain("Dashboard: Jobs By Status");
    const want = REPORT_TAB_RESOURCES.flatMap((r) => registry[r].filter((a) => isShownPermission(r, a)).map((a) => `${r}.${a}`));
    expect(rows.map((r) => `${r.resource}.${r.action}`)).toEqual(want);
    expect(titles).not.toContain("Create Reports");
  });

  it("leaves out what the schema lacks", () => {
    expect(reportRows({ reports: ["view"] })).toEqual([
      expect.objectContaining({ resource: "reports", action: "view", title: "Reports" }),
    ]);
    expect(actionSections({ deals: ["view"], reports: ["view"] })).toEqual([
      { label: "Jobs & clients", resources: [{ resource: "deals", actions: ["view"] }] },
    ]);
  });
});

describe("Search", () => {
  it("finds a row by its title, its sentence or its resource's name, any case", () => {
    expect(permissionMatches("payments", "refund", "refund")).toBe(true);
    expect(permissionMatches("payments", "PAYMENTS", "view")).toBe(true);
    expect(permissionMatches("contacts", "phone numbers", "view_numbers")).toBe(true);
    expect(permissionMatches("contacts", "phone numbers", "delete")).toBe(false);
    expect(permissionMatches("deals", "refund", "view")).toBe(false);
  });

  it("an empty search finds everything", () => {
    expect(permissionMatches("deals", "  ", "view")).toBe(true);
  });

  it("finds a report row by its title", () => {
    expect(permissionMatches("dashboard", "top sources", "view_top_sources")).toBe(true);
    expect(permissionMatches("dashboard", "top sources", "view_sales")).toBe(false);
  });
});
