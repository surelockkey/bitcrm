import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { PaymentTerms, type InvoiceView, type Payment, type PaymentSummary } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  perms: new Set(["payments.view", "payments.collect", "payments.refund"]),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => mocks.perms.has(`${r}.${a}`) }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { InvoicePaymentsSection } from "./invoice-payments-section";

const totals = {
  lineCount: 1, subtotal: 400, taxableSubtotal: 400, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 400, taxRatePercent: 0, tax: 0, total: 400, amountPaid: 0, balanceDue: 400,
};
const invoice: InvoiceView = {
  id: "d1", number: "1042", dealId: "d1", contactId: "c1",
  invoiceDate: "2026-09-16", paymentTerms: PaymentTerms.NET_15, dueDate: "2026-10-01",
  status: "due", totals, version: 1, createdBy: "u1",
  createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z", items: [],
};

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: "p1", invoiceId: "d1", dealId: "d1", contactId: "c1",
    amount: 150, currency: "usd", method: "check", status: "settled", refundedAmount: 0,
    source: "office", takenBy: "u1", takenAt: "2026-09-20T15:00:00.000Z",
    version: 1, createdAt: "2026-09-20T15:00:00.000Z", updatedAt: "2026-09-20T15:00:00.000Z",
    ...over,
  };
}

const summary = (over: Partial<PaymentSummary> = {}): PaymentSummary => ({
  settled: 150, pending: 0, refunded: 0, paymentCount: 1, hasPending: false, ...over,
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function ledger(payments: Payment[], s: PaymentSummary, status = 200) {
  server.use(
    http.get("*/billing/invoices/d1/payments", () =>
      status >= 400
        ? HttpResponse.json({ success: false, message: "Ledger unavailable" }, { status })
        : HttpResponse.json({ success: true, data: { payments, summary: s } }),
    ),
  );
}

function render() {
  renderWithClient(<InvoicePaymentsSection invoice={invoice} dealId="d1" />);
}

beforeEach(() => {
  mocks.perms = new Set(["payments.view", "payments.collect", "payments.refund"]);
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("InvoicePaymentsSection", () => {
  it("lists date, method, reference, amount and status", async () => {
    ledger([payment({ reference: "1042" })], summary());
    render();
    const row = (await screen.findByText("1042")).closest("tr")!;
    expect(row).toHaveTextContent("Sep 20, 2026");
    expect(row).toHaveTextContent("Check");
    expect(row).toHaveTextContent("$150.00");
    expect(row).toHaveTextContent("Paid");
  });

  it("flags a part-paid invoice while the status stays due", async () => {
    ledger([payment()], summary());
    render();
    expect(await screen.findByText("Partially paid")).toBeInTheDocument();
  });

  it("says money is clearing when a bank payment is in flight", async () => {
    ledger([payment({ method: "bank", status: "pending", amount: 400 })], summary({ settled: 0, pending: 400, hasPending: true, paymentCount: 1 }));
    render();
    expect(await screen.findByText(/\$400\.00 clearing/i)).toBeInTheDocument();
    expect(screen.getByText(/2–4 business days/i)).toBeInTheDocument();
    // Nothing has landed, so it is not "partially paid" yet.
    expect(screen.queryByText("Partially paid")).toBeNull();
  });

  it("shows an empty state and still offers Record payment", async () => {
    ledger([], summary({ settled: 0, paymentCount: 0 }));
    render();
    expect(await screen.findByText(/no payments on this invoice yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record payment/i })).toBeInTheDocument();
  });

  it("offers a retry when the ledger can't be loaded", async () => {
    ledger([], summary(), 500);
    render();
    expect(await screen.findByText("Ledger unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("hides Record payment without payments.collect", async () => {
    mocks.perms = new Set(["payments.view"]);
    ledger([payment()], summary());
    render();
    await screen.findByText("$150.00");
    expect(screen.queryByRole("button", { name: /record payment/i })).toBeNull();
  });

  it("renders nothing at all without payments.view", () => {
    mocks.perms = new Set([]);
    const { container } = renderWithClient(<InvoicePaymentsSection invoice={invoice} dealId="d1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a refund only on settled money that has some left, and only with the permission", async () => {
    ledger(
      [
        payment({ id: "p1", amount: 150 }),
        payment({ id: "p2", amount: 100, status: "pending", method: "bank" }),
        payment({ id: "p3", amount: 80, status: "refunded", refundedAmount: 80 }),
      ],
      summary({ settled: 150, pending: 100, hasPending: true, paymentCount: 3 }),
    );
    render();
    await screen.findByText("$150.00");
    expect(screen.getAllByRole("button", { name: /^refund /i })).toHaveLength(1);

    mocks.perms = new Set(["payments.view", "payments.collect"]);
    renderWithClient(<InvoicePaymentsSection invoice={invoice} dealId="d1" />);
    await waitFor(() => expect(screen.getAllByText("$150.00").length).toBeGreaterThan(1));
    expect(screen.getAllByRole("button", { name: /^refund /i })).toHaveLength(1);
  });

  it("resends a receipt from the row", async () => {
    let sent = false;
    ledger([payment()], summary());
    server.use(
      http.post("*/billing/payments/p1/receipt", () => {
        sent = true;
        return HttpResponse.json({ success: true, data: { sent: true, sentTo: "jane@example.com" } });
      }),
    );
    const u = user();
    render();
    await u.click(await screen.findByRole("button", { name: /^resend receipt/i }));
    await waitFor(() => expect(sent).toBe(true));
    expect(toast.success).toHaveBeenCalled();
  });

  it("opens the record-payment dialog prefilled with the balance still owed", async () => {
    ledger([payment()], summary());
    const u = user();
    render();
    await u.click(await screen.findByRole("button", { name: /record payment/i }));
    // $400 invoice, $150 settled → $250 left.
    expect(await screen.findByLabelText("Amount")).toHaveValue("250.00");
  });
});
