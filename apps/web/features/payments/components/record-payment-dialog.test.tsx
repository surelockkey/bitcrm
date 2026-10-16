import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { DEFAULT_PAYMENT_SETTINGS } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

/** Stripe, faked: the card fields are placeholders, the PaymentMethod comes straight back. */
const stripe = vi.hoisted(() => ({
  createPaymentMethod: vi.fn(async () => ({ paymentMethod: { id: "pm_web_1" } })),
  handleNextAction: vi.fn(async () => ({})),
}));
const loadStripe = vi.hoisted(() => vi.fn(async () => stripe));
vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe }));
/** What each card box was given, as Stripe would get it. */
const elementOptions = vi.hoisted(() => ({}) as Record<"number" | "expiry" | "cvc", unknown>);
vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CardNumberElement: ({ options }: { options?: unknown }) => {
    elementOptions.number = options;
    return <div data-testid="card-number" />;
  },
  CardExpiryElement: ({ options }: { options?: unknown }) => {
    elementOptions.expiry = options;
    return <div data-testid="card-expiry" />;
  },
  CardCvcElement: ({ options }: { options?: unknown }) => {
    elementOptions.cvc = options;
    return <div data-testid="card-cvc" />;
  },
  useStripe: () => stripe,
  useElements: () => ({ getElement: () => ({ kind: "card-number" }) }),
}));

import { RecordPaymentDialog } from "./record-payment-dialog";
import { ctToday } from "@/lib/timezone";

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
let posted: Record<string, unknown> | undefined;
let charged: Record<string, unknown> | undefined;
let receipt: Record<string, unknown> | undefined;

function handlers(
  over: {
    status?: number;
    message?: string;
    publishableKey?: string | null;
    surchargePercent?: number;
    intent?: Record<string, unknown>;
  } = {},
) {
  server.use(
    http.get("*/billing/payment-settings", () =>
      HttpResponse.json({
        success: true,
        data: {
          ...DEFAULT_PAYMENT_SETTINGS,
          surchargePercent: over.surchargePercent ?? 0,
          surchargeLabel: "Service fee",
          stripeConfigured: over.publishableKey !== null,
          publishableKey: over.publishableKey === undefined ? "pk_test_1" : over.publishableKey,
        },
      }),
    ),
    http.get("*/crm/contacts/c1", () =>
      HttpResponse.json({
        success: true,
        data: { id: "c1", firstName: "Walter", lastName: "White", phones: [], emails: ["walter@example.com"] },
      }),
    ),
    http.post("*/billing/invoices/d1/payments", async ({ request }) => {
      posted = (await request.json()) as Record<string, unknown>;
      if (over.status && over.status >= 400) {
        return HttpResponse.json({ success: false, message: over.message ?? "Nope" }, { status: over.status });
      }
      return HttpResponse.json({
        success: true,
        data: { id: "p9", amount: posted.amount, method: posted.method, status: "settled" },
      });
    }),
    http.post("*/billing/deals/d1/card-intent", async ({ request }) => {
      charged = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        success: true,
        data: {
          paymentId: charged.attemptId,
          intentId: "pi_1",
          clientSecret: "pi_1_secret",
          status: "succeeded",
          amount: charged.amount,
          tipAmount: 0,
          feeAmount: 0,
          total: charged.amount,
          currency: "usd",
          ...over.intent,
        },
      });
    }),
    http.post("*/billing/payments/:id/receipt", async ({ request }) => {
      receipt = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      return HttpResponse.json({ success: true, data: { sent: true, sentTo: "walter@example.com" } });
    }),
  );
}

function open(balanceDue = 240.5, extra: Partial<React.ComponentProps<typeof RecordPaymentDialog>> = {}) {
  const onOpenChange = vi.fn();
  renderWithClient(
    <RecordPaymentDialog
      invoiceId="d1"
      dealId="d1"
      contactId="c1"
      balanceDue={balanceDue}
      open
      onOpenChange={onOpenChange}
      {...extra}
    />,
  );
  return { onOpenChange };
}

async function pickType(u: ReturnType<typeof user>, name: string) {
  await u.click(await screen.findByLabelText("Payment type"));
  await u.click(await screen.findByRole("option", { name }));
}

beforeEach(() => {
  posted = undefined;
  charged = undefined;
  receipt = undefined;
  toast.success.mockClear();
  toast.error.mockClear();
  stripe.createPaymentMethod.mockClear();
  stripe.handleNextAction.mockClear();
  loadStripe.mockClear();
  handlers();
});

describe("RecordPaymentDialog — Workiz's Add payment", () => {
  it("is titled Add payment, says the balance and fills it in, with today as Paid on", async () => {
    open();
    expect(screen.getByRole("dialog", { name: "Add payment" })).toBeInTheDocument();
    expect(screen.getByText("Balance due: $240.50")).toBeInTheDocument();
    expect(await screen.findByLabelText("Amount")).toHaveValue("240.50");
    expect(screen.getByLabelText("Paid on")).toHaveValue(ctToday());
  });

  it("says so when the job has no balance", async () => {
    open(0);
    expect(await screen.findByText("This job doesn't have any balance")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toHaveValue("");
  });

  it("fills in Connecticut's today, not the browser's", async () => {
    // 23:30 EDT on Oct 12 — a Kyiv (or UTC) browser is already on the 13th.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T03:30:00.000Z"));
    try {
      open();
      expect(await screen.findByLabelText("Paid on")).toHaveValue("2026-10-12");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists Workiz's payment types in Workiz's order, Credit charge first when Stripe is set up", async () => {
    const u = user();
    open();
    await u.click(await screen.findByLabelText("Payment type"));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(10));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Credit charge",
      "Cash",
      "Credit offline",
      "Check",
      "Bank transfer (offline)",
      "Cash app",
      "Consumer financing",
      "Venmo",
      "Zelle",
      "Debit offline",
    ]);
  });

  it("offers no Credit charge without Stripe — nor where the caller asks for offline types only", async () => {
    handlers({ publishableKey: null });
    const u = user();
    open();
    await u.click(await screen.findByLabelText("Payment type"));
    expect(await screen.findByRole("option", { name: "Cash" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Credit charge" })).toBeNull();
  });

  it("offers no Credit charge when the caller allows offline types only", async () => {
    const u = user();
    open(240.5, { allowCharge: false });
    await u.click(await screen.findByLabelText("Payment type"));
    expect(await screen.findByRole("option", { name: "Cash" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Credit charge" })).toBeNull();
  });

  it("records a Zelle payment with its confirmation code, paid-on date, referral flag and note", async () => {
    const u = user();
    const { onOpenChange } = open();
    await u.clear(await screen.findByLabelText("Amount"));
    await u.type(screen.getByLabelText("Amount"), "125.50");
    await pickType(u, "Zelle");
    await u.type(screen.getByLabelText("Confirmation code"), "ZL-1042");
    await u.click(screen.getByLabelText("Charged by referral"));
    await u.type(screen.getByLabelText(/note/i), "Left with the office");
    await u.click(screen.getByRole("button", { name: "Add payment" }));

    await waitFor(() => expect(posted).toBeTruthy());
    expect(posted).toMatchObject({
      amount: 125.5,
      method: "other",
      methodDetail: "zelle",
      reference: "ZL-1042",
      note: "Left with the office",
      chargedByReferral: true,
    });
    expect(String(posted!.takenAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalled();
  });

  it("files a bank transfer made outside Stripe as bank, and cash as cash with no referral flag", async () => {
    const u = user();
    open();
    await pickType(u, "Bank transfer (offline)");
    await u.click(screen.getByRole("button", { name: "Add payment" }));
    await waitFor(() => expect(posted).toMatchObject({ method: "bank", methodDetail: "bank_transfer_offline" }));
    expect(posted!.chargedByReferral).toBeUndefined();
  });

  it("refuses an amount of zero without calling the API", async () => {
    const u = user();
    open();
    await u.clear(await screen.findByLabelText("Amount"));
    await u.type(screen.getByLabelText("Amount"), "0");
    await u.click(screen.getByRole("button", { name: "Add payment" }));
    expect(await screen.findByText(/greater than \$0\.00/i)).toBeInTheDocument();
    expect(posted).toBeUndefined();
  });

  it("keeps the dialog open and shows why when the server refuses", async () => {
    handlers({ status: 409, message: "That invoice is already paid in full" });
    const u = user();
    const { onOpenChange } = open();
    await u.click(await screen.findByRole("button", { name: "Add payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already paid in full");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("does not load Stripe until Credit charge is chosen", async () => {
    const u = user();
    open();
    await screen.findByLabelText("Amount");
    expect(loadStripe).not.toHaveBeenCalled();
    await pickType(u, "Credit charge");
    expect(await screen.findByTestId("card-number")).toBeInTheDocument();
    expect(loadStripe).toHaveBeenCalledWith("pk_test_1");
  });
});

describe("RecordPaymentDialog — Credit charge", () => {
  it("shows the card form: name on card from the client, card number, MM/YY, CVV, ZIP, the client's email", async () => {
    const u = user();
    open();
    await pickType(u, "Credit charge");
    expect(await screen.findByLabelText("Name on card")).toHaveValue("Walter White");
    expect(screen.getByTestId("card-number")).toBeInTheDocument();
    expect(screen.getByTestId("card-expiry")).toBeInTheDocument();
    expect(screen.getByTestId("card-cvc")).toBeInTheDocument();
    expect(screen.getByLabelText("Zip code")).toBeInTheDocument();
    expect(screen.getByLabelText("Client's email address (optional)")).toBeInTheDocument();
    // No fee configured: no fee line.
    expect(screen.queryByText(/service fee/i)).toBeNull();
    expect(screen.getByText("TOTAL")).toBeInTheDocument();
    expect(screen.queryByLabelText(/offline/i)).toBeNull();
    expect(screen.queryByLabelText("Confirmation code")).toBeNull();
    expect(screen.queryByText(/save this card/i)).toBeNull();
    // Workiz's footer: Close · Charge.
    const footer = screen.getByRole("button", { name: "Charge" }).parentElement!;
    expect(within(footer).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("adds the account's service fee — the same cents billing charges", async () => {
    handlers({ surchargePercent: 3 });
    const u = user();
    open(33.5);
    await pickType(u, "Credit charge");
    const breakdown = await screen.findByTestId("charge-breakdown");
    expect(within(breakdown).getByText("SERVICE FEE (3%)")).toBeInTheDocument();
    expect(within(breakdown).getByText("$1.01")).toBeInTheDocument();
    expect(within(breakdown).getByText("$34.51")).toBeInTheDocument();
  });

  it("charges the card: a PaymentMethod made in the browser, the job's card intent, a toast and a receipt to the typed email", async () => {
    const u = user();
    const { onOpenChange } = open(100);
    await pickType(u, "Credit charge");
    await u.type(await screen.findByLabelText("Zip code"), "06103");
    // The client's own email, ready for the receipt.
    expect(screen.getByLabelText("Client's email address (optional)")).toHaveValue("walter@example.com");
    await u.click(screen.getByRole("button", { name: "Charge" }));

    await waitFor(() => expect(charged).toBeTruthy());
    expect(stripe.createPaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "card",
        billing_details: { name: "Walter White", email: "walter@example.com", address: { postal_code: "06103" } },
      }),
    );
    expect(charged).toEqual({ amount: 100, attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/), paymentMethodId: "pm_web_1" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Charged $100.00");
    await waitFor(() => expect(receipt).toEqual({ channel: "email", to: "walter@example.com" }));
  });

  it("shows a decline inline and stays open; the next try is a new attempt", async () => {
    handlers({ intent: { status: "requires_payment_method", declineMessage: "Your card was declined." } });
    const u = user();
    const { onOpenChange } = open(100);
    await pickType(u, "Credit charge");
    await u.type(await screen.findByLabelText("Zip code"), "06103");
    await u.click(screen.getByRole("button", { name: "Charge" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your card was declined.");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    const first = charged!.attemptId;
    await u.click(screen.getByRole("button", { name: "Charge" }));
    await waitFor(() => expect(charged!.attemptId).not.toBe(first));
  });

  it("asks for the name on card and the ZIP before charging", async () => {
    const u = user();
    open(100);
    await pickType(u, "Credit charge");
    await u.clear(await screen.findByLabelText("Name on card"));
    await u.click(screen.getByRole("button", { name: "Charge" }));
    expect(await screen.findByText("Enter the name on the card")).toBeInTheDocument();
    expect(screen.getByText("Enter the card's ZIP code")).toBeInTheDocument();
    expect(stripe.createPaymentMethod).not.toHaveBeenCalled();
    expect(charged).toBeUndefined();
  });
});

/** The kit box a labelled field sits in. */
const kitSlot = (label: string) =>
  screen.getByLabelText(label).closest("[data-slot]")?.getAttribute("data-slot");

describe("RecordPaymentDialog — Workiz's look", () => {
  // Workiz opens the window with every box at rest: the balance in Amount is
  // not selected for overtyping.
  it("opens with nothing focused, the dialog itself holding focus", async () => {
    open();
    const amount = await screen.findByLabelText("Amount");
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
    expect(amount).not.toHaveFocus();
  });

  it("says the balance in bold ink under the title", async () => {
    open();
    expect(await screen.findByText("Balance due: $240.50")).toHaveClass("font-semibold", "text-foreground");
  });

  it("draws Amount and Payment type in the Workiz kit's boxes, the chevron with no rule before it", async () => {
    open();
    await screen.findByLabelText("Amount");
    expect(kitSlot("Amount")).toBe("wz-text-field");
    const type = screen.getByLabelText("Payment type").closest("[data-slot=wz-select]")!;
    expect(type).not.toBeNull();
    expect(type.querySelector("[data-slot=wz-select-separator]")).toBeNull();
  });

  it("draws the offline types in the kit's boxes too, with Close and Add payment in the footer", async () => {
    open();
    await screen.findByLabelText("Amount");
    expect(kitSlot("Confirmation code")).toBe("wz-text-field");
    expect(kitSlot("Paid on")).toBe("wz-text-field");
    expect(screen.getByLabelText("Charged by referral").closest("[data-slot]")?.getAttribute("data-slot")).toBe("wz-checkbox");
    expect(screen.getByLabelText(/note/i).closest("[data-slot]")?.getAttribute("data-slot")).toBe("wz-textarea");
    const footer = screen.getByRole("button", { name: "Add payment" }).closest("[data-slot=dialog-footer]") as HTMLElement;
    expect(within(footer).getByRole("button", { name: "Close" })).toHaveAttribute("data-slot", "wz-button");
    expect(within(footer).getByRole("button", { name: "Add payment" })).toHaveAttribute("data-slot", "wz-button");
  });

  it("gives the card boxes Workiz's words inside, no card-brand icon and no Link autofill", async () => {
    const u = user();
    open();
    await pickType(u, "Credit charge");
    await screen.findByTestId("card-number");
    expect(elementOptions.number).toMatchObject({ placeholder: "Card number", showIcon: false, disableLink: true });
    expect(elementOptions.expiry).toMatchObject({ placeholder: "MM/YY" });
    expect(elementOptions.cvc).toMatchObject({ placeholder: "CVV" });
    // Stripe's frames cannot be labelled from outside: their boxes are.
    expect(within(screen.getByRole("group", { name: "Card number" })).getByTestId("card-number")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "MM/YY" })).getByTestId("card-expiry")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "CVV" })).getByTestId("card-cvc")).toBeInTheDocument();
  });

  it("lays the card out as Workiz: MM/YY beside CVV, then Zip code alone at half width, then the email", async () => {
    const u = user();
    open();
    await pickType(u, "Credit charge");
    const expiryRow = (await screen.findByTestId("card-expiry")).closest("[data-slot=card-row]") as HTMLElement;
    expect(within(expiryRow).getByTestId("card-cvc")).toBeInTheDocument();
    expect(within(expiryRow).queryByLabelText("Zip code")).toBeNull();
    const zipRow = screen.getByLabelText("Zip code").closest("[data-slot=card-row]") as HTMLElement;
    expect(zipRow).not.toBe(expiryRow);
    expect(zipRow).toHaveClass("grid-cols-2");
    expect(zipRow.querySelectorAll("input")).toHaveLength(1);
    for (const label of ["Name on card", "Zip code", "Client's email address (optional)"]) {
      expect(kitSlot(label)).toBe("wz-text-field");
    }
  });

  it("puts Close and Charge in the footer as Workiz's two 200px pills", async () => {
    const u = user();
    open();
    await pickType(u, "Credit charge");
    const charge = await screen.findByRole("button", { name: "Charge" });
    const footer = charge.closest("[data-slot=dialog-footer]") as HTMLElement;
    const close = within(footer).getByRole("button", { name: "Close" });
    for (const b of [close, charge]) {
      expect(b).toHaveAttribute("data-slot", "wz-button");
      expect(b).toHaveClass("w-[200px]");
    }
    expect(close).toHaveAttribute("data-variant", "secondary");
    expect(charge).toHaveAttribute("data-variant", "primary");
  });
});
