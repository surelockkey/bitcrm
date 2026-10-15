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

  it("names a payment by its Workiz type, and says 'By referral' when the referral partner collected it", async () => {
    serve(
      jobLedger({
        payments: [
          payment({ id: "p1", method: "other", methodDetail: "zelle", methodLabel: "Zelle", chargedByReferral: true, reference: "ZL-1" }),
          payment({ id: "p2", method: "bank", methodDetail: "bank_transfer_offline", reference: "BT-2" }),
        ],
      }),
    );
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    const zelle = (await screen.findByTitle("ZL-1")).closest("tr")!;
    expect(zelle).toHaveTextContent("Zelle");
    expect(zelle).toHaveTextContent("By referral");
    expect(zelle).not.toHaveTextContent("By Mike Tech");
    expect(screen.getByTitle("BT-2").closest("tr")!).toHaveTextContent("Bank transfer (offline)");
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

  it("keeps Resend receipt, Refund and Delete behind the row's ⋮, drawn outside the scrolling table", async () => {
    serve(jobLedger());
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    const trigger = await screen.findByRole("button", { name: /actions for the \$100\.00 cash payment/i });
    await user().click(trigger);
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent?.trim())).toEqual(["Resend receipt", "Refund", "Delete"]);
    // The table scrolls sideways (overflow-x: auto), which also clips anything hanging
    // below it — a menu drawn inside the wrapper was invisible on a one-row ledger.
    expect(trigger.closest(".overflow-x-auto")).not.toBeNull();
    expect(screen.getByRole("menu").closest(".overflow-x-auto")).toBeNull();
  });

  it("deletes a mis-keyed cash payment after a confirmation and refreshes the ledger", async () => {
    let deleted: string | null = null;
    serve(jobLedger());
    server.use(
      http.delete("*/billing/payments/:id", ({ params }) => {
        deleted = String(params.id);
        return HttpResponse.json({ success: true, data: { deleted: true } });
      }),
    );
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /actions for the \$100\.00 cash payment/i }));
    await u.click(screen.getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/delete this payment\?/i);
    expect(dialog).toHaveTextContent("$100.00 cash payment");
    expect(deleted).toBeNull();
    await u.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toBe("p1"));
    expect(toast.success).toHaveBeenCalledWith("Deleted the $100.00 cash payment");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("keeps the payment when the confirmation is cancelled", async () => {
    let deleted = false;
    serve(jobLedger());
    server.use(http.delete("*/billing/payments/:id", () => { deleted = true; return HttpResponse.json({ success: true, data: { deleted: true } }); }));
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /actions for the \$100\.00 cash payment/i }));
    await u.click(screen.getByRole("menuitem", { name: "Delete" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deleted).toBe(false);
  });

  it("never offers Delete on a payment that went through Stripe — only Refund", async () => {
    serve(jobLedger({ payments: [payment({ method: "card", stripePaymentIntentId: "pi_1", last4: "4242" })] }));
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    await user().click(await screen.findByRole("button", { name: /actions for the \$100\.00 card payment/i }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent?.trim())).toEqual(["Resend receipt", "Refund"]);
  });

  it("says why when the server refuses the delete", async () => {
    serve(jobLedger());
    server.use(
      http.delete("*/billing/payments/:id", () =>
        HttpResponse.json(
          { success: false, error: { code: "CONFLICT", message: "This payment went through Stripe — refund it instead of deleting it" } },
          { status: 409 },
        ),
      ),
    );
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    const u = user();
    await u.click(await screen.findByRole("button", { name: /actions for the \$100\.00 cash payment/i }));
    await u.click(screen.getByRole("menuitem", { name: "Delete" }));
    await u.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/refund it instead/i)));
  });

  it("leaves only Resend receipt to someone who may collect but not refund", async () => {
    mocks.perms = new Set(["payments.view", "payments.collect"]);
    serve(jobLedger());
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    await user().click(await screen.findByRole("button", { name: /actions for the \$100\.00 cash payment/i }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent?.trim())).toEqual(["Resend receipt"]);
  });

  it("adds an offline payment on the JOB, not on an invoice", async () => {
    let posted: unknown;
    serve(jobLedger(), (b) => (posted = b));
    renderWithClient(<DealPaymentsTab deal={{ id: "d1" }} />);
    await user().click(await screen.findByRole("button", { name: /add payment/i }));
    const dialog = await screen.findByRole("dialog");
    // Prefilled with the balance.
    expect(within(dialog).getByLabelText(/amount/i)).toHaveValue("50.00");
    await user().click(within(dialog).getByRole("button", { name: "Add payment" }));
    await waitFor(() => expect(posted).toMatchObject({ amount: 50, method: "cash", methodDetail: "cash" }));
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
