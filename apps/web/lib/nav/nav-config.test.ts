import { describe, it, expect } from "vitest";
import {
  MAIN_NAV,
  OVERVIEW_ITEM,
  SETTINGS_ITEM,
  TEAM_NAV,
  TECHNICIAN_HOME,
  TECHNICIAN_NAV,
  visibleNavItems,
  type NavItem,
} from "./nav-config";
import type { Resource } from "@bitcrm/types";

const group = (label: string) => MAIN_NAV.find((g) => g.label === label)!;
const labels = (items: NavItem[]) => items.map((i) => i.label);
const only = (...resources: Resource[]) => (r: Resource) => resources.includes(r);

describe("TECHNICIAN_NAV", () => {
  it("leads with the phone-first day list, which is also the technician's home", () => {
    expect(TECHNICIAN_NAV[0]).toMatchObject({ label: "My Jobs", href: "/my-jobs" });
    expect(TECHNICIAN_HOME).toBe("/my-jobs");
  });

  it("offers the van as My Stock, gated on containers.view", () => {
    const stock = TECHNICIAN_NAV.find((i) => i.label === "My Stock")!;
    expect(stock).toMatchObject({ href: "/my-stock", resource: "containers" });
    expect(visibleNavItems(TECHNICIAN_NAV, () => false).map((i) => i.label)).toEqual([
      "My Jobs",
      "My Profile",
    ]);
  });
});

/**
 * The office moving over from Workiz must find every page under the word
 * and in the place Workiz keeps it (app_audit_wz_home): Home · Workiz Phone
 * … | Schedule · Map · Jobs · Clients … | Estimates · Invoices · Price book |
 * Reports | Features ▸ Automations … Inventory. What Workiz lacks stays, in
 * the block Workiz would file it under.
 */
describe("the sidebar's words and order are Workiz's", () => {
  it("opens with Home, as Workiz's menu does", () => {
    expect(OVERVIEW_ITEM).toMatchObject({ label: "Home", href: "/" });
  });

  it("runs the blocks in Workiz's order: the phone, the work, the documents, reports, features", () => {
    expect(MAIN_NAV.map((g) => g.label)).toEqual([
      "Communications",
      "Work",
      "Documents",
      "Insights",
      "Features",
    ]);
  });

  it("names the pages a Workiz user visits most with Workiz's words", () => {
    expect(labels(group("Communications").items)).toEqual(["BitCRM Phone", "Messages"]);
    expect(labels(group("Work").items)).toEqual(["Schedule", "Map", "Jobs", "Clients", "Companies"]);
    expect(labels(group("Documents").items)).toEqual(["Estimates", "Invoices", "Work Orders", "Price book"]);
    expect(labels(group("Insights").items)).toEqual(["Reports"]);
  });

  it("keeps every row on its route, gated on the page's own resource", () => {
    const byLabel = Object.fromEntries(MAIN_NAV.flatMap((g) => g.items).map((i) => [i.label, i]));
    expect(byLabel["BitCRM Phone"]).toMatchObject({ href: "/calls", resource: "calls" });
    expect(byLabel["Messages"]).toMatchObject({ href: "/messages", resource: "messages" });
    expect(byLabel["Schedule"]).toMatchObject({ href: "/schedule", resource: "deals" });
    expect(byLabel["Map"]).toMatchObject({ href: "/dispatch", resource: "deals" });
    expect(byLabel["Jobs"]).toMatchObject({ href: "/deals", resource: "deals" });
    expect(byLabel["Clients"]).toMatchObject({ href: "/contacts", resource: "contacts" });
    expect(byLabel["Companies"]).toMatchObject({ href: "/companies", resource: "companies" });
    expect(byLabel["Estimates"]).toMatchObject({ href: "/estimates", resource: "estimates" });
    expect(byLabel["Invoices"]).toMatchObject({ href: "/invoices", resource: "invoices" });
    expect(byLabel["Work Orders"]).toMatchObject({ href: "/work-orders", resource: "work_orders" });
    expect(byLabel["Price book"]).toMatchObject({ href: "/price-book", resource: "products" });
    expect(byLabel["Reports"]).toMatchObject({ href: "/reports", resource: "reports" });
    for (const item of MAIN_NAV.flatMap((g) => g.items)) expect(item.icon, item.label).toBeDefined();
  });

  it("files Automations and Inventory under Features, where Workiz keeps them", () => {
    const features = group("Features");
    expect(features.kind).toBe("features");
    expect(features.items).toEqual([
      expect.objectContaining({ label: "Automations", href: "/automations", resource: "settings" }),
      expect.objectContaining({
        label: "Inventory",
        href: "/inventory",
        resources: ["products", "warehouses", "containers", "transfers"],
      }),
    ]);
    expect(MAIN_NAV.filter((g) => g.kind === "features")).toHaveLength(1);
  });

  it("keeps Team under Settings only, as Workiz does: no Technicians, Users, Roles or Settings rows", () => {
    const hrefs = MAIN_NAV.flatMap((g) => g.items).map((i) => i.href);
    for (const href of ["/technicians", "/admin/users", "/admin/roles", "/settings"]) {
      expect(hrefs, href).not.toContain(href);
    }
    // Reached from the settings home's tiles and the command palette instead.
    expect(TEAM_NAV.map((i) => [i.label, i.href, i.resource])).toEqual([
      ["Technicians", "/technicians", "technicians"],
      ["Users", "/admin/users", "users"],
      ["Roles", "/admin/roles", "roles"],
    ]);
    expect(SETTINGS_ITEM).toMatchObject({ label: "Settings", href: "/settings", resource: "settings" });
  });

  it("has no Payments entry: Workiz keeps the Payments report under Reports, so do we", () => {
    expect(MAIN_NAV.flatMap((g) => g.items).find((i) => i.href === "/payments")).toBeUndefined();
  });

  it("lists no route twice", () => {
    const hrefs = [OVERVIEW_ITEM, ...MAIN_NAV.flatMap((g) => g.items), ...TEAM_NAV, SETTINGS_ITEM].map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("visibleNavItems", () => {
  it("keeps available, permitted items and hides coming-soon ones by default", () => {
    expect(labels(visibleNavItems(group("Work").items, () => true))).toEqual([
      "Schedule",
      "Map",
      "Jobs",
      "Clients",
      "Companies",
    ]);
  });

  it("hides items the user cannot view", () => {
    expect(visibleNavItems(group("Work").items, () => false)).toEqual([]);
  });

  it("shows a user only the pages they may view", () => {
    expect(labels(visibleNavItems(group("Work").items, only("deals")))).toEqual(["Schedule", "Map", "Jobs"]);
    expect(labels(visibleNavItems(group("Documents").items, only("invoices")))).toEqual(["Invoices"]);
    expect(labels(visibleNavItems(group("Communications").items, only("messages")))).toEqual(["Messages"]);
    expect(labels(visibleNavItems(group("Features").items, only("messages")))).toEqual([]);
  });

  it("shows a multi-resource item when any one resource is viewable", () => {
    expect(labels(visibleNavItems(group("Features").items, only("warehouses")))).toEqual(["Inventory"]);
    expect(labels(visibleNavItems(group("Features").items, only("settings")))).toEqual(["Automations"]);
  });

  it("shows Price book to someone who can view products, hides it otherwise", () => {
    expect(labels(visibleNavItems(group("Documents").items, only("products")))).toEqual(["Price book"]);
    expect(labels(visibleNavItems(group("Documents").items, only("warehouses")))).toEqual([]);
  });
});
