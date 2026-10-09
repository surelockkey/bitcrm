import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { InventoryFrame, useReportInventoryReady } from "./inventory-frame";

vi.mock("next/navigation", () => ({ usePathname: () => "/inventory/warehouses" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));
vi.mock("@/features/inventory/tab-counts", () => ({
  useInventoryTabCounts: () => ({ counts: { items: 3106, warehouses: 3 }, settled: true }),
}));

function Page({ ready }: { ready: boolean }) {
  useReportInventoryReady(ready);
  return <p>{ready ? "rows" : "skeleton"}</p>;
}

/**
 * The tab row and its counters come with the page under it: while the page
 * holds its skeleton the row holds its places; the frame the page is whole in
 * is the frame the counters appear in — and they stay through the next tab's
 * load.
 */
describe("InventoryFrame", () => {
  it("holds the tabs' places until the page is whole, then draws them with their counters", () => {
    const { rerender } = render(
      <InventoryFrame>
        <Page ready={false} />
      </InventoryFrame>,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("navigation", { name: "Inventory sections" })).toHaveAttribute("aria-busy", "true");

    rerender(
      <InventoryFrame>
        <Page ready />
      </InventoryFrame>,
    );
    expect(screen.getByRole("link", { name: "Inventory 99+" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Warehouses 3" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the tabs drawn while the next tab loads", () => {
    const { rerender } = render(
      <InventoryFrame>
        <Page ready />
      </InventoryFrame>,
    );
    rerender(
      <InventoryFrame>
        <Page key="next" ready={false} />
      </InventoryFrame>,
    );
    expect(screen.getByText("skeleton")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Warehouses 3" })).toBeInTheDocument();
  });
});
