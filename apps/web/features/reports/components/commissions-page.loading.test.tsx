import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { COMMISSION_REPORT_TOTAL_KEYS, type CommissionReport, type CommissionReportTotals } from "@bitcrm/types";
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
 * The Commissions report does not jump.
 *
 * Its filter row was drawn at once, each select as narrow as its one
 * placeholder option, and widened as its catalog arrived — the job types,
 * the areas, the companies, the ad groups (the slowest, seconds late), and
 * the technicians with the report itself. Every widening pushed the selects
 * to its right along and wrapped the row, so the loading block under it slid
 * down (CLS 0.28 on the audit). Now the row and the report come in one
 * frame, each select already holding its options; a new period keeps the
 * current figures on screen until the new ones are in.
 */

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

const totals = (total: number): CommissionReportTotals =>
  Object.fromEntries(
    COMMISSION_REPORT_TOTAL_KEYS.map((k) => [k, { amount: k === "total" ? total : 0, jobs: k === "total" ? 1 : 0 }]),
  ) as CommissionReportTotals;

const report = (total: number): CommissionReport => ({
  window: { by: "closed", from: "2026-10-06", to: "2026-10-06" },
  mode: "standard",
  count: 1,
  offset: 0,
  limit: 50,
  rows: [
    {
      dealId: "d1",
      dealNumber: "AB12CD",
      techId: "t1",
      techName: "Ann Lee",
      techIds: ["t1"],
      createdAt: "2026-10-01T15:00:00.000Z",
      scheduledDate: "2026-10-06",
      scheduledTimeSlot: "10:00-11:00",
      closedDate: "2026-10-06",
      closedTime: "11:00",
      jobTypeName: "Lockout",
      address: "1 Test St, Springfield",
      total,
      cash: 0,
      credit: total,
      billing: 0,
      check: 0,
      rate: 50,
      rateUnit: "%",
      rateSource: "tech",
      tip: 0,
      parts: 0,
      companyParts: 0,
      techProfit: total / 2,
      externalCompanyProfit: 0,
      companyProfit: total / 2,
      tax: 0,
      cashByExternal: 0,
      creditByExternal: 0,
      billingByExternal: 0,
      checkByExternal: 0,
      balance: 0,
      source: "workiz",
    },
  ],
  totals: totals(total),
  techs: [{ techId: "t1", techName: "Ann Lee", jobs: 3, total, techProfit: 0, parts: 0, companyParts: 0, tip: 0, tax: 0, balance: 0 }],
  externalCompanies: [],
  computedRows: 0,
  truncated: false,
  warnings: [],
});

const routes: FakeRoute[] = [
  // "Created" is a different period on the server — and a different total.
  {
    match: /\/deals\/reports\/commissions$/,
    reply: (url) => report(url.searchParams.get("by") === "created" ? 222 : 111),
    delayMs: 60,
  },
  // The order dev answers in: the companies and areas first, the job types
  // next, the ad groups last of all — after the report.
  { match: /\/deals\/external-companies$/, reply: () => [{ id: "ext-1", name: "Partner LLC" }], delayMs: 20 },
  { match: /\/deals\/service-areas$/, reply: () => [{ id: "sa-1", name: "North" }], delayMs: 30 },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-1", name: "Lockout" }], delayMs: 40 },
  { match: /\/deals\/job-sources$/, reply: () => [{ id: "src-1", name: "Google" }], delayMs: 150 },
];

let server: FakeServer;

const { CommissionsPage } = await import("./commissions-page");

const select = (label: string) => document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
const options = (label: string) => [...(select(label)?.options ?? [])].map((o) => o.textContent ?? "");
const FILTERS = ["Job type", "Technician", "Service area", "External company", "Ad group"];
const tableUp = () => !!document.querySelector('table[aria-label="Commissions"]');

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommissionsPage — no jumping", () => {
  it("draws the filters, their options and the report in one frame", async () => {
    const watch = watchFirstFrame(
      () => FILTERS.some((f) => select(f)) || tableUp(),
      () => ({
        table: tableUp(),
        jobType: options("Job type").includes("Lockout"),
        tech: options("Technician").includes("Ann Lee  [3]"),
        area: options("Service area").includes("North"),
        company: options("External company").includes("Partner LLC"),
        adGroup: options("Ad group").includes("Google"),
        skeletons: skeletonCount(),
      }),
    );
    renderWithClient(<CommissionsPage today="2026-10-06" />);
    await screen.findByRole("table", { name: "Commissions" }, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ table: true, jobType: true, tech: true, area: true, company: true, adGroup: true, skeletons: 0 });
  });

  it("never draws a filter before its options are in", async () => {
    const narrow = new Set<string>();
    const observer = new MutationObserver(() => {
      for (const f of FILTERS) if (select(f) && select(f)!.options.length < 2) narrow.add(f);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    renderWithClient(<CommissionsPage today="2026-10-06" />);
    await screen.findByRole("table", { name: "Commissions" }, { timeout: 3000 });
    await settle();
    observer.disconnect();

    expect([...narrow]).toEqual([]);
  });

  it("keeps the figures on screen while another period loads", async () => {
    renderWithClient(<CommissionsPage today="2026-10-06" />);
    await screen.findByRole("table", { name: "Commissions" }, { timeout: 3000 });
    await settle();

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0 || !tableUp() || FILTERS.some((f) => !select(f))) blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    fireEvent.click(screen.getByRole("radio", { name: "Created" }));
    await screen.findAllByText("222.00", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blanked).toBe(false);
  });

  it("asks for each thing once", async () => {
    renderWithClient(<CommissionsPage today="2026-10-06" />);
    await screen.findByRole("table", { name: "Commissions" }, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
