import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { JobPaymentLedger, Payment } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  perms: new Set(["payments.view", "payments.collect", "payments.refund"]),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string, a = "view") => mocks.perms.has(`${r}.${a}`) }),
}));
vi.mock("@/features/deals/hooks", () => ({
  useUserMap: () => ({
    map: new Map([["u1", { id: "u1", firstName: "Mike", lastName: "Tech" }]]),
    users: [],
    isLoading: false,
  }),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { DealPaymentsTab, paymentsTabCaption } from "./deal-payments-tab";

function payment(over: Partial<Payment> = {}): Payment {
  return {
    id: "p1", invoiceId: "d1", dealId: "d1", contactId: "c1",
    amount: 100, currency: "usd", method: "cash", status: "settled", refundedAmount: 0,
    source: "office", takenBy: "u1", takenAt: "2026-05-04T19:00:00.000Z",
    version: 1, createdAt: "2026-05-04T19:00:00.000Z", updatedAt: "2026-05-04T19:00:00.000Z",
    ...over,
  };
}

function jobLedger(over: Partial<JobPaymentLedger> = {}): JobPaymentLedger {
  return {
    dealId: "d1",
    payments: [payment({ tipAmount: 15, reference: "env #12" })],
    summary: { settled: 100, pending: 0, refunded: 0, paymentCount: 1, hasPending: false },
    total: 150,
    amountPaid: 100,
    balanceDue: 50,
    ...over,
  };
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function serve(data: JobPaymentLedger, onPost?: (body: unknown) => void) {
  server.use(
    http.get("*/billing/deals/d1/payments", () => HttpResponse.json({ success: true, data })),
    http.post("*/billing/deals/d1/payments", async ({ request }) => {
      const body = await request.json();
      onPost?.(body);
      return HttpResponse.json({ success: true, data: payment({ id: "p2", amount: 50 }) });
    }),
    // The invoice route must NOT be used for a job without an invoice.
    http.post("*/billing/invoices/d1/payments", () =>
      HttpResponse.json({ success: false, message: "Invoice not found" }, { status: 404 }),
    ),
  );
}

beforeEach(() => {
  mocks.perms = new Set(["payments.view", "payments.collect", "payments.refund"]);
  toast.success.mockClear();
  toast.error.mockClear();
});

describe("DealPaymentsTab — a job's payments, with or without an invoice", () => {
  // audit_pixels T4: Workiz's row is one 65px line ("Cash By referral"); the
  // reference waits in the Type cell's tooltip.
  it("lists type and who collected, amount and tip, the date Workiz's way, and the reference on hover", async () => {
    serve(jobLedger());
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    const type = await screen.findByTitle("env #12");
    const row = type.closest("tr")!;
    expect(screen.queryByText("env #12")).not.toBeInTheDocument();
    // 19:00 UTC is 3:00 PM on business (New York) time.
    expect(row).toHaveTextContent("5/4/2026 at 3:00 PM");
    expect(row).toHaveTextContent("Cash");
    expect(row).toHaveTextContent("By Mike Tech");
    expect(row).toHaveTextContent("$100.00");
    expect(row).toHaveTextContent("$15.00 tip");
  });

  it("heads the tab with the balance over the job's total — 'Balance $50.00/$150.00'", async () => {
    serve(jobLedger());
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    expect(await screen.findByTestId("deal-payments-balance")).toHaveTextContent("$50.00");
    expect(screen.getByText("$150.00")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Balance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Job payments" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Type", "Amount", "Date", "Status", ""]);
  });

  it("invites '+ Add payments' on a job with none", async () => {
    serve(jobLedger({ payments: [], amountPaid: 0, balanceDue: 150, summary: { settled: 0, pending: 0, refunded: 0, paymentCount: 0, hasPending: false } }));
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    await user().click(await screen.findByRole("button", { name: "Add payments" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("says there are none to someone who may not take one", async () => {
    mocks.perms = new Set(["payments.view"]);
    serve(jobLedger({ payments: [], amountPaid: 0, balanceDue: 150, summary: { settled: 0, pending: 0, refunded: 0, paymentCount: 0, hasPending: false } }));
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    expect(await screen.findByText(/no payments on this job yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add payments" })).toBeNull();
  });

  it("keeps Resend receipt and Refund behind the row's ⋮", async () => {
    serve(jobLedger());
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    await user().click(await screen.findByRole("button", { name: /actions for the \$100\.00 cash payment/i }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Resend receipt", "Refund"]);
  });

  it("adds an offline payment on the JOB, not on an invoice", async () => {
    let posted: unknown;
    serve(jobLedger(), (b) => (posted = b));
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    await user().click(await screen.findByRole("button", { name: /add payment/i }));
    const dialog = await screen.findByRole("dialog");
    // Prefilled with the balance.
    expect(within(dialog).getByLabelText(/amount/i)).toHaveValue("50.00");
    await user().click(within(dialog).getByRole("button", { name: /record payment/i }));
    await waitFor(() => expect(posted).toMatchObject({ amount: 50, method: "cash" }));
    expect(toast.success).toHaveBeenCalledWith("Recorded $50.00");
  });

  it("offers Create invoice only when the page asks for it", async () => {
    serve(jobLedger());
    const onCreate = vi.fn();
    const { unmount } = renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} onCreateInvoice={onCreate} />);
    await user().click(await screen.findByRole("button", { name: /create invoice/i }));
    expect(onCreate).toHaveBeenCalled();
    unmount();

    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    await screen.findByTitle("env #12");
    expect(screen.queryByRole("button", { name: /create invoice/i })).toBeNull();
  });

  it("hides Add payment and refunds without the permissions", async () => {
    mocks.perms = new Set(["payments.view"]);
    serve(jobLedger());
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    await screen.findByTitle("env #12");
    expect(screen.queryByRole("button", { name: /add payment/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /refund/i })).toBeNull();
  });

  it("renders nothing without payments.view", () => {
    mocks.perms = new Set();
    const { container } = renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("paymentsTabCaption", () => {
  it("reads like Workiz: \"$0.00 balance\"", () => {
    expect(paymentsTabCaption(0)).toBe("$0.00 balance");
    expect(paymentsTabCaption(50)).toBe("$50.00 balance");
    expect(paymentsTabCaption(undefined)).toBeNull();
  });
});
