import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ItemsReportPage as ReportPage } from "@bitcrm/types";
import {
  declaredRowHeights,
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  watchLoadingRowHeights,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";

/**
 * The Items and services report stays still while it loads — a guard, not a
 * fix: the audit found it already clean (CLS 0, one skeleton, then the
 * table). The job types, categories and people it asks for only feed the closed filter's list,
 * so the table does not wait for them; this keeps it that way, and keeps a
 * new period from blanking the table.
 */

const perms = vi.hoisted(() => ({ loading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  // While the matrix loads, `can` says no to everything — as the real one does.
  usePermissions: () => ({ can: () => !perms.loading, isLoading: perms.loading }),
}));

/** What the server says about the money columns — the report's own word, once it answers. */
const flags = { money: true };

const page = (name: string): ReportPage => ({
  rows: [{ key: "p1", number: 101, name, type: "product", units: 3, price: 90, cost: 30, profit: 60, margin: 66.67, jobs: 2, servicePlan: false }],
  totals: { items: 1, units: 3, price: 90, cost: 30, profit: 60, margin: 66.67 },
  pagination: { page: 1, pageSize: 50, total: 1, pages: 1, from: 1, to: 1 },
  window: { from: "2026-10-01", to: "2026-10-06" },
  sort: { column: "number", dir: "desc" },
  money: flags.money,
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

// The bold Total row is the grid's first record (rep_items_wz_01_loaded).
const tableUp = () => !!screen.queryByText("Total", { selector: "b" });

beforeEach(() => {
  perms.loading = false;
  flags.money = true;
  server = installFakeServer(routes);
});

/**
 * probe_shift 2026-10-09: with the permissions still on their way the loader
 * drew the grid without Price, Cost and Profit, and when they answered the
 * three came in and every other cell narrowed. The loader now guesses the
 * money columns until the report itself says (`money` in its answer); a
 * report without them is drawn anew, not reshuffled.
 */
describe("ItemsReportPage — the columns while the permissions load", () => {
  const headers = () => [...document.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
  const grid = () => document.querySelector('[data-slot="wz-report-grid"]');

  it("guesses the money columns while the permissions load and keeps the very grid once the report confirms them", async () => {
    perms.loading = true;
    renderWithClient(<ItemsReportPage today="2026-10-06" />);
    const first = grid();
    expect(headers()).toEqual(expect.arrayContaining(["Price", "Cost", "Profit"]));

    await screen.findByText("Door lock", {}, { timeout: 3000 });
    expect(grid()).toBe(first);
    expect(headers()).toEqual(expect.arrayContaining(["Price", "Cost", "Profit"]));
  });

  it("draws the grid anew — not reshuffled — when the report comes without the money", async () => {
    perms.loading = true;
    flags.money = false;
    renderWithClient(<ItemsReportPage today="2026-10-06" />);
    const first = grid();

    await screen.findByText("Door lock", {}, { timeout: 3000 });
    expect(headers()).not.toContain("Price");
    expect(first!.isConnected).toBe(false);
  });
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
    fireEvent.click(screen.getByRole("button", { name: /^Date range/ }));
    fireEvent.click(screen.getByRole("option", { name: "Last month" }));
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

  // app_audit 2026-10-09: CLS 0.10–0.13 — the loader's 56px blanks became
  // Workiz's 77px rows (a line over the grey `_tblLbl` line, rep_items) and
  // the pager inside the grid went down with them. Blanks, records and
  // filler now all declare the 77px.
  it("lands its rows on the loader's blank rows — the same declared row height before and after", async () => {
    const watch = watchLoadingRowHeights();
    renderWithClient(<ItemsReportPage today="2026-10-06" />);
    await screen.findByText("Door lock", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual(["77px"]);
    expect(declaredRowHeights()).toEqual(["77px"]);
  });
});
