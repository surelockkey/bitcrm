import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortalDocumentSummary, PortalPaymentOptions, PortalPaymentSession } from "@bitcrm/types";

/* Stripe is stubbed wholesale: these tests are about our panel, not theirs. */
const confirm = vi.fn();
let checkoutState: unknown = { type: "success", checkout: { confirm } };

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: vi.fn(async () => null) }));
vi.mock("@stripe/react-stripe-js/checkout", () => ({
  CheckoutElementsProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="stripe-provider">{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useCheckoutElements: () => checkoutState,
}));

import { PaymentPanel, type PaymentLoaders } from "./payment-panel";

const doc: PortalDocumentSummary = {
  kind: "invoice",
  id: "d1",
  number: "1042",
  date: "2026-09-12",
  status: "due",
  total: 300,
  balanceDue: 120.5,
  sent: true,
  payable: true,
};

const options: PortalPaymentOptions = {
  invoiceId: "d1",
  number: "1042",
  amountDue: 120.5,
  amountPending: 0,
  currency: "usd",
  methods: ["card", "bank"],
  allowPartial: true,
  bankMinimum: 20,
  surchargePercent: 0,
  surchargeLabel: "Card processing fee",
  tipsEnabled: false,
  tipPresets: [],
};

const session: PortalPaymentSession = {
  clientSecret: "cs_test_secret",
  publishableKey: "pk_test_123",
  paymentId: "pay_1",
  amount: 120.5,
  surcharge: 0,
  tip: 0,
  total: 120.5,
  currency: "usd",
};

function loaders(over: Partial<PaymentLoaders> = {}): PaymentLoaders {
  return {
    getOptions: vi.fn(async () => options),
    start: vi.fn(async () => session),
    getStatus: vi.fn(async () => ({ status: "settled" as const, amount: 120.5, method: "card" as const, receiptSent: true })),
    ...over,
  };
}

function setup(props: Partial<React.ComponentProps<typeof PaymentPanel>> = {}) {
  const onClose = vi.fn();
  const onPaid = vi.fn();
  const l = (props.loaders as PaymentLoaders | undefined) ?? loaders();
  render(
    <PaymentPanel
      doc={doc}
      loaders={l}
      onClose={onClose}
      onPaid={onPaid}
      businessName="Acme Locks"
      returnUrl={(id) => `https://portal.test/tok?payment=${id}`}
      {...props}
    />,
  );
  return { onClose, onPaid, loaders: l };
}

beforeEach(() => {
  confirm.mockReset();
  confirm.mockResolvedValue({ type: "success", session: { status: { type: "complete", paymentStatus: "paid" } } });
  checkoutState = { type: "success", checkout: { confirm } };
});

afterEach(() => vi.useRealTimers());

describe("PaymentPanel — choosing what to pay", () => {
  it("defaults to the whole balance and shows one summary with no fee row", async () => {
    setup();
    const amount = await screen.findByLabelText(/amount to pay/i);
    expect(amount).toHaveValue("120.50");

    const summary = screen.getByRole("group", { name: /payment summary/i });
    expect(within(summary).getByText(/^total$/i)).toBeInTheDocument();
    expect(within(summary).queryByText(/processing fee/i)).toBeNull();
    expect(within(summary).getAllByText("$120.50").length).toBeGreaterThan(0);
  });

  it("shows the fee row and a raised total only when the business surcharges", async () => {
    setup({ loaders: loaders({ getOptions: vi.fn(async () => ({ ...options, surchargePercent: 3 })) }) });
    const summary = await screen.findByRole("group", { name: /payment summary/i });
    expect(within(summary).getByText(/card processing fee/i)).toBeInTheDocument();
    expect(within(summary).getByText("$3.62")).toBeInTheDocument();
    expect(within(summary).getByText("$124.12")).toBeInTheDocument();
  });

  it("locks the amount, with a reason, when partial payment is off", async () => {
    setup({ loaders: loaders({ getOptions: vi.fn(async () => ({ ...options, allowPartial: false })) }) });
    const amount = await screen.findByLabelText(/amount to pay/i);
    expect(amount).toHaveAttribute("readonly");
    expect(screen.getByText(/paid in one go/i)).toBeInTheDocument();
  });

  it("refuses more than the balance and blocks the way forward until it is fixed", async () => {
    const user = userEvent.setup();
    setup();
    const amount = await screen.findByLabelText(/amount to pay/i);
    await user.clear(amount);
    await user.type(amount, "500");

    expect(await screen.findByText(/more than the \$120\.50 balance/i)).toBeInTheDocument();
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("hides the method choice when there is only one way to pay", async () => {
    setup({ loaders: loaders({ getOptions: vi.fn(async (): Promise<PortalPaymentOptions> => ({ ...options, methods: ["card"] })) }) });
    await screen.findByLabelText(/amount to pay/i);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("disables bank below its minimum and says what to do instead", async () => {
    const user = userEvent.setup();
    setup();
    const amount = await screen.findByLabelText(/amount to pay/i);
    await user.clear(amount);
    await user.type(amount, "10");

    const bank = screen.getByRole("radio", { name: /bank account/i });
    await waitFor(() => expect(bank).toBeDisabled());
    expect(screen.getByText(/bank payments start at \$20\.00/i)).toBeInTheDocument();
  });

  it("notes money already clearing, without deducting it twice", async () => {
    setup({ loaders: loaders({ getOptions: vi.fn(async () => ({ ...options, amountPending: 40 })) }) });
    expect(await screen.findByText(/\$40\.00 is already on its way/i)).toBeInTheDocument();
  });
});

describe("PaymentPanel — paying", () => {
  it("creates the session with the chosen amount and method, then shows the Element under the summary", async () => {
    const user = userEvent.setup();
    const l = loaders();
    setup({ loaders: l });

    const amount = await screen.findByLabelText(/amount to pay/i);
    await user.clear(amount);
    await user.type(amount, "50");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() => expect(l.start).toHaveBeenCalledWith(doc, { amount: 50, method: "card" }));
    expect(await screen.findByTestId("payment-element")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /payment summary/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pay \$120\.50/i })).toBeInTheDocument();
  });

  it("confirms with the return url and reports success, reloading the portal behind it", async () => {
    const user = userEvent.setup();
    const { onPaid } = setup();
    await screen.findByLabelText(/amount to pay/i);
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(await screen.findByRole("button", { name: /pay \$120\.50/i }));

    expect(await screen.findByText(/payment received/i)).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledWith({ returnUrl: "https://portal.test/tok?payment=pay_1", redirect: "if_required" });
    await waitFor(() => expect(onPaid).toHaveBeenCalled());
  });

  it("keeps the amount and lets the customer retry in place when the card is declined", async () => {
    const user = userEvent.setup();
    confirm.mockResolvedValue({ type: "error", error: { message: "Your card was declined.", code: "paymentFailed" } });
    setup();
    await screen.findByLabelText(/amount to pay/i);
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(await screen.findByRole("button", { name: /pay \$120\.50/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/your card was declined/i);
    expect(alert).toHaveTextContent(/nothing has been charged/i);
    expect(screen.getByTestId("payment-element")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pay \$120\.50/i })).toBeEnabled();
  });

  it("tells the truth about a bank transfer: started, not settled", async () => {
    const user = userEvent.setup();
    confirm.mockResolvedValue({ type: "success", session: { status: { type: "complete", paymentStatus: "unpaid" } } });
    const { onPaid } = setup();
    await screen.findByLabelText(/amount to pay/i);
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(await screen.findByRole("button", { name: /pay \$120\.50/i }));

    expect(await screen.findByText(/2–4 business days/i)).toBeInTheDocument();
    expect(screen.getByText(/email you when it clears/i)).toBeInTheDocument();
    await waitFor(() => expect(onPaid).toHaveBeenCalled());
  });
});

describe("PaymentPanel — when there is nothing to do", () => {
  it("says the invoice is settled instead of showing a dead pay button", async () => {
    setup({ loaders: loaders({ getOptions: vi.fn(async () => ({ ...options, amountDue: 0 })) }) });
    expect(await screen.findByText(/nothing left to pay/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
  });

  it("names the business to call when online payment is not on offer", async () => {
    setup({ loaders: loaders({ getOptions: vi.fn(async (): Promise<PortalPaymentOptions> => ({ ...options, methods: [] })) }) });
    expect(await screen.findByText(/acme locks/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
  });

  it("treats a dead link as a dead link, not a server error", async () => {
    const { PublicApiError } = await import("./lib");
    setup({ loaders: loaders({ getOptions: vi.fn(async () => { throw new PublicApiError(410, "gone"); }) }) });
    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
  });

  it("offers a retry when the network is the problem", async () => {
    const { PublicApiError } = await import("./lib");
    const getOptions = vi.fn(async () => { throw new PublicApiError(0, "offline"); });
    setup({ loaders: loaders({ getOptions }) });
    const retry = await screen.findByRole("button", { name: /try again/i });
    expect(screen.getByText(/check your connection/i)).toBeInTheDocument();
    await userEvent.click(retry);
    await waitFor(() => expect(getOptions).toHaveBeenCalledTimes(2));
  });
});

describe("PaymentPanel — coming back from a redirect", () => {
  it("polls the ledger a bounded number of times, then falls back to an email promise", async () => {
    vi.useFakeTimers();
    const getStatus = vi.fn(async () => ({ status: "pending" as const, amount: 120.5, method: "bank" as const, receiptSent: false }));
    setup({ loaders: loaders({ getStatus }), resumePaymentId: "pay_1" });

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(getStatus).toHaveBeenCalledWith("pay_1");
    expect(getStatus.mock.calls.length).toBeLessThanOrEqual(10);
    expect(screen.getByText(/2–4 business days/i)).toBeInTheDocument();
  });

  it("stops as soon as the webhook has landed and the money is in", async () => {
    vi.useFakeTimers();
    const getStatus = vi.fn(async () => ({ status: "settled" as const, amount: 120.5, method: "card" as const, receiptSent: true }));
    const { onPaid } = setup({ loaders: loaders({ getStatus }), resumePaymentId: "pay_1" });

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/payment received/i)).toBeInTheDocument();
    expect(onPaid).toHaveBeenCalled();
  });
});
