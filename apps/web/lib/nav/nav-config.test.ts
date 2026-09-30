import { describe, it, expect } from "vitest";
import { MAIN_NAV, TECHNICIAN_HOME, TECHNICIAN_NAV, visibleNavItems } from "./nav-config";
import type { Resource } from "@bitcrm/types";

const work = MAIN_NAV.find((g) => g.label === "Work")!;
const communications = MAIN_NAV.find((g) => g.label === "Communications")!;

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

describe("MAIN_NAV structure", () => {
  it("has a single Inventory entry in Work instead of an Inventory group", () => {
    expect(MAIN_NAV.find((g) => g.label === "Inventory")).toBeUndefined();

    const inventory = work.items.find((i) => i.label === "Inventory")!;
    expect(inventory).toBeDefined();
    expect(inventory.href).toBe("/inventory");
    // Visible if the user can view any of the inventory resources.
    expect(inventory.resources).toEqual([
      "products",
      "warehouses",
      "containers",
      "transfers",
    ]);
  });

  it("puts Price Book right after Inventory in Work, on products.view", () => {
    const labels = work.items.map((i) => i.label);
    expect(labels.indexOf("Price Book")).toBe(labels.indexOf("Inventory") + 1);
    const priceBook = work.items.find((i) => i.label === "Price Book")!;
    expect(priceBook).toMatchObject({ href: "/price-book", resource: "products" });
    expect(priceBook.icon).toBeDefined();
  });

  it("shows Price Book to someone who can view products, hides it otherwise", () => {
    expect(visibleNavItems(work.items, (r: Resource) => r === "products").map((i) => i.label)).toEqual([
      "Inventory",
      "Price Book",
    ]);
    expect(visibleNavItems(work.items, (r: Resource) => r === "warehouses").map((i) => i.label)).toEqual([
      "Inventory",
    ]);
  });

  it("puts Automations in Communications as a first-level item gated on settings", () => {
    const automations = communications.items.find((i) => i.label === "Automations")!;
    expect(automations).toMatchObject({ href: "/automations", resource: "settings" });
    // It sits after the inbox: a rule that texts a client belongs next to it.
    expect(communications.items.map((i) => i.label)).toEqual([
      "Calls",
      "Messages",
      "Automations",
    ]);
  });

  it("hides Automations from a user without settings.view", () => {
    const items = visibleNavItems(communications.items, (r: Resource) => r === "messages");
    expect(items.map((i) => i.label)).toEqual(["Messages"]);
  });
});

describe("MAIN_NAV billing", () => {
  const billing = MAIN_NAV.find((g) => g.label === "Billing")!;

  it("ships the payments report gated on payments.view", () => {
    const payments = billing.items.find((i) => i.label === "Payments")!;
    expect(payments).toMatchObject({ href: "/payments", resource: "payments" });
    expect(payments.status).toBeUndefined();
  });

  it("hides it from a user who cannot view payments", () => {
    const items = visibleNavItems(billing.items, (r: Resource) => r === "invoices");
    expect(items.map((i) => i.label)).toEqual(["Invoices"]);
  });
});

describe("visibleNavItems", () => {
  it("keeps available, permitted items and hides coming-soon ones by default", () => {
    const items = visibleNavItems(work.items, () => true);
    expect(items.map((i) => i.label)).toEqual([
      "Jobs",
      "Dispatch Map",
      "Schedule",
      "Inventory",
      "Price Book",
    ]);
  });

  it("hides items the user cannot view", () => {
    const items = visibleNavItems(work.items, () => false);
    expect(items).toEqual([]);
  });

  it("shows a multi-resource item when any one resource is viewable", () => {
    const items = visibleNavItems(work.items, (r: Resource) => r === "warehouses");
    expect(items.map((i) => i.label)).toEqual(["Inventory"]);
  });

  it("hides a multi-resource item when none of its resources are viewable", () => {
    const items = visibleNavItems(work.items, (r: Resource) => r === "deals");
    expect(items.map((i) => i.label)).toEqual([
      "Jobs",
      "Dispatch Map",
      "Schedule",
    ]);
  });
});
