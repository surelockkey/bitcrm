import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { PaymentTerms, type Deal, type InvoiceView } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  products: [] as { productId: string }[],
  perms: new Set(["invoices.view", "invoices.create", "invoices.edit", "invoices.send", "invoices.delete"]),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => mocks.perms.has(`${r}.${a}`) }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useDealProducts: () => ({ data: mocks.products, isLoading: false }),
}));
vi.mock("@/features/deals/components/deal-products-tab", () => ({
  DealProductsTab: ({ showPayments }: { showPayments?: boolean }) => (
    <div data-testid="job-items" data-payments={String(!!showPayments)} />
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { DealInvoiceTab } from "./deal-invoice-tab";

const deal = { id: "d1", dealNumber: "1042", contactId: "c1", assignedTechIds: [] } as unknown as Deal;
const totals = {
  lineCount: 1, subtotal: 100, taxableSubtotal: 100, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 100, taxRatePercent: 0, tax: 0, total: 100, amountPaid: 0, balanceDue: 100,
};
const invoice: InvoiceView = {
  id: "d1", number: "1042", dealId: "d1", contactId: "c1",
  invoiceDate: "2026-09-16", paymentTerms: PaymentTerms.NET_15, dueDate: "2026-10-01",
  status: "due", totals, version: 1, createdBy: "u1",
  createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z", items: [],
};

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  mocks.products = [];
  server.use(http.get("*/billing/templates", () => HttpResponse.json({ success: true, data: [] })));
});

describe("DealInvoiceTab — no invoice", () => {
  beforeEach(() => {
    server.use(http.get("*/billing/invoices/by-deal/d1", () => HttpResponse.json({ success: true, data: null })));
  });

  it("disables Create invoice while the job has no items", async () => {
    renderWithClient(<DealInvoiceTab deal={deal} canEditItems />);
    const btn = await screen.findByRole("button", { name: /create invoice/i });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Add at least one item to the job first")).toBeInTheDocument();
  });

  it("creates the invoice for a job with items", async () => {
    mocks.products = [{ productId: "p1" }];
    let body: unknown;
    server.use(
      http.post("*/billing/invoices", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: invoice });
      }),
    );
    renderWithClient(<DealInvoiceTab deal={deal} canEditItems />);
    await user().click(await screen.findByRole("button", { name: /create invoice/i }));
    await waitFor(() => expect(body).toEqual({ dealId: "d1" }));
  });

  it("hides creation without the permission", async () => {
    mocks.perms.delete("invoices.create");
    renderWithClient(<DealInvoiceTab deal={deal} canEditItems />);
    expect(await screen.findByText(/no invoice yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create invoice/i })).not.toBeInTheDocument();
    mocks.perms.add("invoices.create");
  });
});

describe("DealInvoiceTab — existing invoice", () => {
  beforeEach(() => {
    server.use(http.get("*/billing/invoices/by-deal/d1", () => HttpResponse.json({ success: true, data: invoice })));
  });

  it("shows the header, status, sent state and the job's items with payments", async () => {
    renderWithClient(<DealInvoiceTab deal={deal} canEditItems />);
    expect(await screen.findByRole("heading", { name: "Invoice #1042" })).toBeInTheDocument();
    expect(screen.getByText("Due")).toBeInTheDocument();
    expect(screen.getByText("Unsent")).toBeInTheDocument();
    expect(screen.getByTestId("job-items")).toHaveAttribute("data-payments", "true");
    expect(screen.getByLabelText("Invoice date")).toHaveValue("2026-09-16");
    // Fixed terms own the due date.
    expect(screen.getByLabelText("Due date")).toBeDisabled();
  });

  it("marks the invoice as sent", async () => {
    let body: unknown;
    server.use(
      http.post("*/billing/invoices/d1/mark-sent", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ...invoice, sentAt: "2026-09-16T11:00:00.000Z" } });
      }),
    );
    renderWithClient(<DealInvoiceTab deal={deal} canEditItems />);
    await user().click(await screen.findByRole("button", { name: /mark as sent/i }));
    await waitFor(() => expect(body).toEqual({ sent: true }));
  });

  it("recomputes the due date when the invoice date changes", async () => {
    let body: unknown;
    server.use(
      http.patch("*/billing/invoices/d1", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: invoice });
      }),
    );
    renderWithClient(<DealInvoiceTab deal={deal} canEditItems />);
    const input = await screen.findByLabelText("Invoice date");
    const u = user();
    await u.clear(input);
    await u.type(input, "2026-09-20");
    input.blur();
    await waitFor(() => expect(body).toEqual({ invoiceDate: "2026-09-20", dueDate: "2026-10-05" }));
  });

  it("offers Send by text only to someone who may both send invoices and send messages", async () => {
    const { unmount } = renderWithClient(<DealInvoiceTab deal={deal} canEditItems />);
    await screen.findByRole("heading", { name: "Invoice #1042" });
    expect(screen.queryByRole("button", { name: /send by text/i })).not.toBeInTheDocument();
    unmount();

    mocks.perms.add("messages.send");
    try {
      renderWithClient(<DealInvoiceTab deal={deal} canEditItems />);
      expect(await screen.findByRole("button", { name: /send by text/i })).toBeInTheDocument();
    } finally {
      mocks.perms.delete("messages.send");
    }
  });

  it("explains that deleting keeps the job's items", async () => {
    renderWithClient(<DealInvoiceTab deal={deal} canEditItems />);
    await user().click(await screen.findByRole("button", { name: /delete invoice/i }));
    expect(await screen.findByText(/items stay on the job/i)).toBeInTheDocument();
  });
});
