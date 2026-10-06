import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ItemsReportPage as ReportPage } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";

/**
 * The Items and services report stays still while it loads — a guard, not a
 * fix: the audit found it already clean (CLS 0, one skeleton, then the
 * table). The job types it asks for only feed the closed filter's popover,
 * so the table does not wait for them; this keeps it that way, and keeps a
 * new period from blanking the table.
 */

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

const page = (name: string): ReportPage => ({
  rows: [{ key: "p1", number: 101, name, type: "product", units: 3, price: 90, cost: 30, profit: 60, margin: 66.67, jobs: 2, servicePlan: false }],
  totals: { items: 1, units: 3, price: 90, cost: 30, profit: 60, margin: 66.67 },
  pagination: { page: 1, pageSize: 50, total: 1, pages: 1, from: 1, to: 1 },
  window: { from: "2026-10-01", to: "2026-10-06" },
  sort: { column: "number", dir: "desc" },
  money: true,
  options: { categories: [], soldBy: [] },
});

const routes: FakeRoute[] = [
  {
    match: /\/deals\/report\/items$/,
    reply: (url) => page(url.searchParams.get("from") === "2026-10-01" ? "Door lock" : "Key blank"),
    delayMs: 40,
  },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-1", name: "Lockout" }], delayMs: 120 },
];

let server: FakeServer;

const { ItemsReportPage } = await import("./items-report-page");

const tableUp = () => !!screen.queryByRole("row", { name: "Total" });

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ItemsReportPage — no jumping", () => {
  it("draws the table, its Total row and its footer in one frame", async () => {
    const watch = watchFirstFrame(tableUp, () => ({
      item: !!screen.queryByText("Door lock"),
      footer: !!screen.queryByText("Showing 1 to 1 of 1 results"),
      skeletons: skeletonCount(),
    }));
    renderWithClient(<ItemsReportPage today="2026-10-06" />);
    await screen.findByText("Door lock", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ item: true, footer: true, skeletons: 0 });
  });

  it("keeps the table on screen while another period loads", async () => {
    renderWithClient(<ItemsReportPage today="2026-10-06" />);
    await screen.findByText("Door lock", {}, { timeout: 3000 });
    await settle();

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0 || !tableUp()) blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    fireEvent.change(screen.getByRole("combobox", { name: "Date preset" }), { target: { value: "last_month" } });
    await screen.findByText("Key blank", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blanked).toBe(false);
  });

  it("asks for each thing once", async () => {
    renderWithClient(<ItemsReportPage today="2026-10-06" />);
    await screen.findByText("Door lock", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
