import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { PaymentTerms, type Invoice } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ push: vi.fn(), canView: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => mocks.canView }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useContactMap: () => ({ map: new Map([["c1", { firstName: "Jane", lastName: "Smith" }]]), isLoading: false }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "t1") }));
vi.mock("sonner", () => ({ toast }));

import { InvoicesPage } from "./invoices-page";

const totals = {
  lineCount: 1, subtotal: 100, taxableSubtotal: 100, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 100, taxRatePercent: 0, tax: 0, total: 100, amountPaid: 0, balanceDue: 100,
};
const inv = (over: Partial<Invoice>): Invoice => ({
  id: "d1", number: "1042", dealId: "d1", contactId: "c1", invoiceDate: "2026-09-16",
  paymentTerms: PaymentTerms.CASH, dueDate: "2026-09-16", status: "due", totals, version: 1,
  createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "", ...over,
});

const listCalls: URLSearchParams[] = [];
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  mocks.canView = true;
  mocks.push.mockClear();
  listCalls.length = 0;
  server.use(
    http.get("*/billing/invoices/summary", () =>
      HttpResponse.json({
        success: true,
        data: { dueAmount: 1234.5, dueCount: 3, overdueAmount: 99, overdueCount: 1, unsentCount: 4, paidAmount: 0, paidCount: 0, needsInvoiceCount: 2 },
      }),
    ),
    http.get("*/billing/invoices", ({ request }) => {
      const params = new URL(request.url).searchParams;
      listCalls.push(params);
      if (params.get("cursor") === "next") {
        return HttpResponse.json({ success: true, data: { items: [inv({ id: "d2", dealId: "d2", number: "1043" })] } });
      }
      return HttpResponse.json({ success: true, data: { items: [inv({})], nextCursor: "next" } });
    }),
    http.get("*/billing/invoices/needing-invoice", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "j1", dealNumber: "2001", contactId: "c1", clientName: "Jane Smith", itemCount: 2, total: 50, createdAt: "2026-09-01T00:00:00Z" },
          { id: "j2", dealNumber: "2002", contactId: "c1", clientName: "Jane Smith", itemCount: 1, total: 20, createdAt: "2026-09-02T00:00:00Z" },
        ],
      }),
    ),
  );
});

describe("InvoicesPage", () => {
  it("shows summary widgets and the invoice table, paging with Load more", async () => {
    renderWithClient(<InvoicesPage />);
    expect(await screen.findByText("$1,234.50")).toBeInTheDocument();
    const row = await screen.findByRole("row", { name: /#1042/ });
    expect(within(row).getByText("Jane Smith")).toBeInTheDocument();
    expect(within(row).getByText("Unsent")).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: /load more/i }));
    expect(await screen.findByRole("row", { name: /#1043/ })).toBeInTheDocument();
  });

  it("filters by status when a widget is clicked and opens the job's invoice tab", async () => {
    renderWithClient(<InvoicesPage />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /overdue.*\$99\.00/i }));
    await waitFor(() => expect(listCalls.some((p) => p.get("status") === "overdue")).toBe(true));
    await u.click(await screen.findByRole("row", { name: /#1042/ }));
    expect(mocks.push).toHaveBeenCalledWith("/deals/d1?tab=invoice");
  });

  it("sends unsent=true from the toggle", async () => {
    renderWithClient(<InvoicesPage />);
    await user().click(await screen.findByRole("switch", { name: /unsent only/i }));
    await waitFor(() => expect(listCalls.some((p) => p.get("unsent") === "true")).toBe(true));
  });

  it("bulk-creates invoices one job at a time", async () => {
    const created: string[] = [];
    server.use(
      http.post("*/billing/invoices", async ({ request }) => {
        const { dealId } = (await request.json()) as { dealId: string };
        created.push(dealId);
        return HttpResponse.json({ success: true, data: inv({ id: dealId }) });
      }),
    );
    renderWithClient(<InvoicesPage />);
    const u = user();
    await u.click(await screen.findByRole("tab", { name: /needs invoice/i }));
    await u.click(await screen.findByRole("checkbox", { name: /select all jobs/i }));
    await u.click(screen.getByRole("button", { name: /create invoices \(2\)/i }));
    await waitFor(() => expect(created).toEqual(["j1", "j2"]));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Created 2 invoices", { id: "t1" }));
  });

  it("shows no-access without the view permission", () => {
    mocks.canView = false;
    renderWithClient(<InvoicesPage />);
    expect(screen.getByText(/don't have permission to view invoices/i)).toBeInTheDocument();
  });
});
