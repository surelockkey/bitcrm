import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { screen } from "@testing-library/react";
import { renderWithClient } from "@/test/render-with-client";
import { TabFallback, type InventoryTab } from "./tab-fallback";

/**
 * An Inventory tab's Suspense fallback is the tab's own frame: the band, the
 * strip, the grid's header over Workiz's loader — an empty fallback meant a
 * blank body and then the whole page popping in.
 */
const WZ_HEADERS: Partial<Record<InventoryTab, string>> = {
  items: "Product ID",
};

const TABLE_HEADERS: Partial<Record<InventoryTab, string>> = {
  warehouses: "SKUs",
  containers: "Department",
  "user-containers": "Access",
  templates: "Used by",
  transfers: "Route",
};

describe("TabFallback", () => {
  it.each(Object.entries(WZ_HEADERS) as [InventoryTab, string][])(
    "draws the %s tab's Workiz grid header over its loader while the page loads",
    (tab, header) => {
      renderWithClient(<TabFallback tab={tab} />);
      const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent);
      expect(headers).toContain(header);
      expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    },
  );

  it.each(Object.entries(TABLE_HEADERS) as [InventoryTab, string][])(
    "draws the %s tab's own table while the page loads",
    (tab, header) => {
      renderWithClient(<TabFallback tab={tab} />);
      const headers = [...document.querySelectorAll("thead th")].map((th) => th.getAttribute("aria-label"));
      expect(headers).toContain(header);
      expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
      expect(screen.getByTestId("list-pagination")).toHaveAttribute("aria-busy", "true");
    },
  );

  // Transfers reads no URL: it is prerendered as itself, skeleton included.
  it("every Inventory tab page behind a Suspense boundary hands it its fallback", () => {
    const root = join(__dirname, "..", "..", "..", "app", "(app)", "inventory", "(tabs)");
    const suspended = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => ({ tab: d.name, page: readFileSync(join(root, d.name, "page.tsx"), "utf8") }))
      .filter(({ page }) => page.includes("<Suspense"));
    expect(suspended.length).toBeGreaterThanOrEqual(5);
    for (const { tab, page } of suspended) {
      expect(page, tab).toContain(`fallback={<TabFallback tab="${tab}" />}`);
    }
  });
});
