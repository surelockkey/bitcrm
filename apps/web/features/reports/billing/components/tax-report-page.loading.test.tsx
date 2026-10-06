import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { TaxReport, TaxReportBasis } from "@bitcrm/types";
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
 * The tax report does not jump.
 *
 * Its KPI was drawn at once as "—" with its caption beside it, and the
 * caption slid right when the figure came; the "Tax to show" select widened
 * when the period's rates came. Now the figure, the select with its rates
 * and the table come in one frame, and Paid/Accrual or another period keeps
 * the figure on screen until the new one is in.
 */

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

const report = (basis: TaxReportBasis): TaxReport => ({
  basis,
  from: "2026-10-01",
  to: "2026-10-06",
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
const taxOptions = () =>
  [...(document.querySelector<HTMLSelectElement>('select[aria-label="Tax to show"]')?.options ?? [])].map((o) => o.textContent);

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TaxReportPage — no jumping", () => {
  it("draws the figure, the rates and the table in one frame", async () => {
    const watch = watchFirstFrame(
      () => !!kpi() || taxOptions().length > 0,
      () => ({
        kpi: kpi()?.textContent ?? null,
        rates: taxOptions(),
        table: !!screen.queryByText("State sales tax"),
        skeletons: skeletonCount(),
      }),
    );
    renderWithClient(<TaxReportPage />);
    await screen.findByText("State sales tax", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ kpi: "$123.45", rates: ["All taxes", "State (6.35%)"], table: true, skeletons: 0 });
  });

  it("keeps the figure on screen while the other basis loads", async () => {
    renderWithClient(<TaxReportPage />);
    await screen.findByText("State sales tax", {}, { timeout: 3000 });
    await settle();

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0 || !kpi() || kpi()!.textContent === "—") blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    fireEvent.click(screen.getByRole("tab", { name: "Paid" }));
    await screen.findByText("State (paid)", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blanked).toBe(false);
  });

  it("asks for each thing once", async () => {
    renderWithClient(<TaxReportPage />);
    await screen.findByText("State sales tax", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
