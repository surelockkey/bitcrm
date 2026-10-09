import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { TaxReport, TaxReportBasis } from "@bitcrm/types";
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
 * The tax report does not jump.
 *
 * Its figure was drawn at once as "—" with its caption beside it, and the
 * caption slid right when the figure came. Now the sentence ("$123.45 total
 * tax on sold items"), the rows and the pager come in one frame; and since a
 * tab reopens on its defaults (Workiz), both tabs' opening reports come with
 * the page — Paid opens whole, its sentence never blank.
 */

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

const report = (basis: TaxReportBasis): TaxReport => ({
  basis,
  from: "2026-10-01",
  to: "2026-10-09",
  rows: [
    {
      key: "State|6.35",
      name: basis === "paid" ? "State (paid)" : "State",
      description: "State sales tax",
      rate: 6.35,
      ratePercent: 6.35,
      amount: basis === "paid" ? 50 : 123.45,
      taxableAmount: 1944.09,
      nonTaxableAmount: 0,
      jobs: 4,
    },
  ],
  totalAmount: basis === "paid" ? 50 : 123.45,
  taxes: [{ key: "State|6.35", name: "State", rate: 6.35 }],
});

const routes: FakeRoute[] = [
  { match: /\/deals\/report\/tax$/, reply: (url) => report((url.searchParams.get("basis") ?? "accrual") as TaxReportBasis), delayMs: 60 },
];

let server: FakeServer;

const { TaxReportPage } = await import("./tax-report-page");

const kpi = () => document.querySelector('[data-testid="tax-kpi"]');

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TaxReportPage — no jumping", () => {
  it("draws the sentence, the rows and the pager in one frame", async () => {
    const watch = watchFirstFrame(
      () => !!kpi(),
      () => ({
        kpi: kpi()?.textContent ?? null,
        table: !!screen.queryByText("State sales tax"),
        pager: !!screen.queryByText("Showing 1 to 1 of 1 results"),
        skeletons: skeletonCount(),
      }),
    );
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    await screen.findByText("State sales tax", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ kpi: "$123.45 total tax on sold items", table: true, pager: true, skeletons: 0 });
  });

  it("opens Paid whole: its sentence never blank, no skeleton", async () => {
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    await screen.findByText("State sales tax", {}, { timeout: 3000 });
    await settle();

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0 || !kpi()) blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    fireEvent.click(screen.getByRole("tab", { name: "Paid" }));
    await screen.findByText("State (paid)", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blanked).toBe(false);
    expect(kpi()?.textContent).toBe("$50.00 total tax from collected payments");
  });

  it("asks for each thing once", async () => {
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    await screen.findByText("State sales tax", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  // app_audit 2026-10-09: CLS 0.06 — the loader's ruled 57px blanks became
  // Workiz's 56px rows (rep_tax) and ten rows crept up 10px. Blanks, records
  // and filler now all declare the 56px.
  it("lands its rows on the loader's blank rows — the same declared row height before and after", async () => {
    const watch = watchLoadingRowHeights();
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    await screen.findByText("State sales tax", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual(["56px"]);
    expect(declaredRowHeights()).toEqual(["56px"]);
  });
});
