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
      const rows = paid ? [row("SURE NY", 8.88, 202.15)] : [row("AZ", 8.6, 39.04, 177.15), row("CT", 6.35, 11558.93, -981.16)];
      return HttpResponse.json({
        success: true,
        data: {
          basis: paid ? "paid" : "accrual",
          ...(paid ? {} : { by: p.get("by") }),
          from: p.get("from"), to: p.get("to"), rows,
          totalAmount: rows.reduce((s, r) => s + r.amount, 0),
          taxes: rows.map((r) => ({ key: r.key, name: r.name, rate: r.rate })),
        },
      });
    }),
  );
});

describe("TaxReportPage", () => {
  it("opens on Accrual, By Job end date, This month", async () => {
    renderWithClient(<TaxReportPage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("row", { name: /CT/ })).toHaveTextContent("-$981.16");
    expect(screen.getByTestId("tax-kpi")).toHaveTextContent("$11,597.97");
    expect(screen.getByText("total tax on sold items")).toBeInTheDocument();
    expect(calls[0].get("basis")).toBe("accrual");
    expect(calls[0].get("by")).toBe("end");
    expect(calls[0].get("from")).toMatch(/^\d{4}-\d{2}-01$/);
    expect(within(table).getByText("Non-Taxable Amount")).toBeInTheDocument();
  });

  it("switches to Paid: its own KPI, no By and no Non-taxable column", async () => {
    renderWithClient(<TaxReportPage />);
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    await screen.findByRole("table");
    await u.click(screen.getByRole("tab", { name: "Paid" }));
    await waitFor(() => expect(calls.some((p) => p.get("basis") === "paid" && !p.has("by"))).toBe(true));
    expect(await screen.findByText("total tax from collected payments")).toBeInTheDocument();
    expect(screen.queryByLabelText("By")).toBeNull();
    expect(screen.queryByText("Non-Taxable Amount")).toBeNull();
    expect(await screen.findByRole("row", { name: /SURE NY/ })).toHaveTextContent("8.88%");
  });

  it("sends the chosen By and the Tax to show", async () => {
    renderWithClient(<TaxReportPage />);
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    await screen.findByRole("table");
    await u.selectOptions(screen.getByLabelText("By"), "created");
    await waitFor(() => expect(calls.some((p) => p.get("by") === "created")).toBe(true));
    await u.selectOptions(screen.getByLabelText("Tax to show"), "AZ|8.6");
    await waitFor(() => expect(calls.some((p) => p.get("tax") === "AZ|8.6")).toBe(true));
  });

  it("refuses without the money permission", () => {
    mocks.canView = false;
    renderWithClient(<TaxReportPage />);
    expect(screen.getByText(/don't have permission to view the tax report/i)).toBeInTheDocument();
  });
});
