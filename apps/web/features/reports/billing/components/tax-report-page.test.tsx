import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ canView: true }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => !mocks.canView,
  usePermissions: () => ({ can: () => mocks.canView }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { TaxReportPage } from "./tax-report-page";

const calls: URLSearchParams[] = [];
const row = (name: string, rate: number, amount: number, nonTaxable?: number) => ({
  key: `${name}|${rate}`, name, description: "", rate, ratePercent: rate, amount, taxableAmount: amount * 10,
  ...(nonTaxable !== undefined && { nonTaxableAmount: nonTaxable }), jobs: 3,
});

beforeEach(() => {
  mocks.canView = true;
  calls.length = 0;
  server.use(
    http.get("*/deals/report/tax", ({ request }) => {
      const p = new URL(request.url).searchParams;
      calls.push(p);
      const paid = p.get("basis") === "paid";
      const all = paid
        ? [row("SURE NY", 8.88, 202.15), row("CT", 6.35, 13330.89)]
        : [row("CT", 6.35, 11558.93, -981.16), row("AZ", 8.6, 39.04, 177.15)];
      const q = p.get("search")?.toLowerCase();
      const rows = all.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!p.get("tax") || r.key === p.get("tax")));
      return HttpResponse.json({
        success: true,
        data: {
          basis: paid ? "paid" : "accrual",
          ...(paid ? {} : { by: p.get("by") }),
          from: p.get("from"), to: p.get("to"), rows,
          totalAmount: rows.reduce((s, r) => s + r.amount, 0),
          taxes: [
            { key: "AZ|5.6", name: "AZ", rate: 5.6 },
            { key: "AZ|8.6", name: "AZ", rate: 8.6 },
            { key: "CT|6.35", name: "CT", rate: 6.35 },
          ],
        },
      });
    }),
  );
});

const grid = async () => screen.findByRole("table");
const bodyNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => r.querySelector("td")?.textContent ?? "")
    .filter(Boolean);

describe("TaxReportPage (Workiz Reports → Tax)", () => {
  it("opens on Accrual — This month, By: Job end date, the bar under Name, A→Z", async () => {
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    const table = await grid();
    expect(await screen.findByRole("heading", { name: "$11,597.97 total tax on sold items" })).toBeInTheDocument();
    expect(bodyNames(table)).toEqual(["AZ", "CT"]);
    expect(within(table).getByRole("row", { name: /CT/ })).toHaveTextContent("-$981.16");
    expect(within(table).getByRole("row", { name: /AZ/ })).toHaveTextContent("8.60%");
    expect(within(table).getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "descending");
    expect(within(table).getByRole("columnheader", { name: /Non-Taxable Amount/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "By: Job end date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Date range: This month, Oct 1st, 2026 - Oct 9th, 2026/ })).toBeInTheDocument();
    expect(screen.getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
    const first = calls.find((p) => p.get("basis") === "accrual")!;
    expect(Object.fromEntries(first)).toEqual({ basis: "accrual", by: "end", from: "2026-10-01", to: "2026-10-09" });
  });

  it("Paid: its own sentence, no By:, the amount headed Tax, no Non-Taxable, Z→A", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    await grid();
    await u.click(screen.getByRole("tab", { name: "Paid" }));
    expect(await screen.findByRole("heading", { name: "$13,533.04 total tax from collected payments" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(bodyNames(table)).toEqual(["SURE NY", "CT"]);
    expect(within(table).getByRole("columnheader", { name: /^Tax$/ })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /Non-Taxable/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^By:/ })).toBeNull();
    expect(calls.some((p) => p.get("basis") === "paid" && !p.has("by"))).toBe(true);
  });

  it("a tab reopens on its own defaults, as Workiz's does", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    await grid();
    await u.click(screen.getByRole("button", { name: "By: Job end date" }));
    await u.click(screen.getByRole("option", { name: "Job created" }));
    await waitFor(() => expect(calls.some((p) => p.get("by") === "created")).toBe(true));
    expect(screen.getByRole("button", { name: "By: Job created" })).toBeInTheDocument();
    await u.click(screen.getByRole("tab", { name: "Paid" }));
    await u.click(screen.getByRole("tab", { name: "Accrual" }));
    expect(await screen.findByRole("button", { name: "By: Job end date" })).toBeInTheDocument();
  });

  it("sends the tax picked in Tax to show — every account tax by its name", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    await grid();
    await u.click(screen.getByRole("combobox", { name: "Tax to show" }));
    const list = screen.getByRole("listbox", { name: "Tax to show" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["All taxes", "AZ", "AZ", "CT"]);
    await u.click(within(list).getAllByRole("option", { name: "AZ" })[1]);
    await waitFor(() => expect(calls.some((p) => p.get("tax") === "AZ|8.6")).toBe(true));
    expect(await screen.findByRole("heading", { name: "$39.04 total tax on sold items" })).toBeInTheDocument();
  });

  it("Accrual sorts the way Workiz's does — Amount ascending lists the largest first", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    const table = await grid();
    await u.click(within(table).getByRole("button", { name: "Sort by Amount" }));
    expect(within(table).getByRole("columnheader", { name: /^Amount/ })).toHaveAttribute("aria-sort", "ascending");
    expect(bodyNames(table)).toEqual(["CT", "AZ"]);
  });

  it("Paid sorts the way the bar says — Tax ascending lists the smallest first", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    await grid();
    await u.click(screen.getByRole("tab", { name: "Paid" }));
    await screen.findByRole("heading", { name: /total tax from collected payments/ });
    const table = screen.getByRole("table");
    await u.click(within(table).getByRole("button", { name: "Sort by Tax" }));
    expect(bodyNames(table)).toEqual(["SURE NY", "CT"]);
    await u.click(within(table).getByRole("button", { name: "Sort by Tax" }));
    expect(bodyNames(table)).toEqual(["CT", "SURE NY"]);
  });

  it("searches on the server; nothing found reads $0.00 over No Records Found", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    await grid();
    await u.type(screen.getByPlaceholderText("Search"), "zzzq");
    await waitFor(() => expect(calls.some((p) => p.get("search") === "zzzq")).toBe(true));
    expect(await screen.findByRole("heading", { name: "$0.00 total tax on sold items" })).toBeInTheDocument();
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });

  it("refuses without the money permission", () => {
    mocks.canView = false;
    renderWithClient(<TaxReportPage today="2026-10-09" />);
    expect(screen.getByText(/don't have permission to view the tax report/i)).toBeInTheDocument();
  });
});
