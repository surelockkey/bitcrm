import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { screen } from "@testing-library/react";
import { renderWithClient } from "@/test/render-with-client";
import { TabFallback, type InventoryTab } from "./tab-fallback";

/**
 * The first HTML of an Inventory tab is its Suspense fallback: the page reads
 * the URL (`?edit=`, `?stock=`), so it renders on the client. An empty
 * fallback meant a blank body and then the whole page popping in. The
 * fallback is the tab's own frame: toolbar, the table's header over a page of
 * placeholder rows, and the pager's place.
 */
const HEADERS: Record<InventoryTab, string> = {
  items: "Product ID",
  warehouses: "SKUs",
  containers: "Department",
  "user-containers": "Access",
  templates: "Used by",
  transfers: "Route",
};

describe("TabFallback", () => {
  it.each(Object.entries(HEADERS) as [InventoryTab, string][])(
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
