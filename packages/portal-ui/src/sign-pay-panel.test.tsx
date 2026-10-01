import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortalDocumentSummary, PortalPaymentOptions } from "@bitcrm/types";

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: vi.fn(async () => null) }));
vi.mock("@stripe/react-stripe-js/checkout", () => ({
  CheckoutElementsProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useCheckoutElements: () => ({ type: "success", checkout: { confirm: vi.fn() } }),
}));

import { SignAndPayPanel } from "./sign-pay-panel";
import type { PaymentLoaders } from "./payment-panel";

function stubCanvas() {
  const ctx = { scale: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,QUJD") as never;
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 160 }) as DOMRect;
}

const estimate: PortalDocumentSummary = {
  kind: "estimate", id: "e1", number: "1042-1", name: "Storefront door", date: "2026-09-30", status: "pending",
  total: 3886.84, sent: true, signatureNeeded: true, depositDue: 1943.42, payable: true,
};

const depositOptions: PortalPaymentOptions = {
  invoiceId: "e1", number: "1042-1", amountDue: 1943.42, amountPending: 0, currency: "usd", methods: ["card"],
  allowPartial: false, bankMinimum: 20, surchargePercent: 0, surchargeLabel: "Card processing fee", tipsEnabled: false, tipPresets: [],
};

const loaders: PaymentLoaders = {
  getOptions: vi.fn(async () => depositOptions),
  start: vi.fn(),
  getStatus: vi.fn(),
};

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

async function draw() {
  const canvas = screen.getByRole("img", { name: /sign here/i });
  fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, pointerId: 1 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
}

describe("SignAndPayPanel (Workiz Sign & Pay)", () => {
  beforeEach(() => stubCanvas());

  it("signature first: Continue is locked until the client draws, then the deposit step opens with the amount", async () => {
    const onSign = vi.fn(async () => undefined);
    render(
      <SignAndPayPanel
        doc={estimate}
        mode="approve"
        signerName="Jane Smith"
        onSign={onSign}
        payment={{ loaders, returnUrl: () => "https://portal.test", noun: "deposit", onPaid: vi.fn() }}
        onClose={vi.fn()}
        businessName="Acme Locks"
      />,
    );
    expect(screen.getByRole("dialog", { name: "Sign & Pay" })).toBeInTheDocument();
    const step2 = screen.getByRole("region", { name: "Make a deposit" });
    expect(within(step2).getByText(/sign first/i)).toBeInTheDocument();
    const cont = screen.getByRole("button", { name: /continue/i });
    expect(cont).toBeDisabled();
    await draw();
    expect(cont).toBeEnabled();
    await user().click(cont);
    await waitFor(() => expect(onSign).toHaveBeenCalledWith({ imageDataUrl: "data:image/png;base64,QUJD", signedBy: "Jane Smith" }));
    expect(await screen.findByLabelText(/amount to pay/i)).toHaveValue("1943.42");
    expect(within(screen.getByRole("region", { name: "Add your signature" })).getByText("Signed")).toBeInTheDocument();
    expect(loaders.getOptions).toHaveBeenCalledWith(estimate);
  });

  it("with no deposit, signing approves the estimate and says so", async () => {
    const onSign = vi.fn(async () => undefined);
    const onClose = vi.fn();
    render(<SignAndPayPanel doc={{ ...estimate, depositDue: undefined }} mode="approve" signerName="Jane" onSign={onSign} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Approve estimate" })).toBeInTheDocument();
    await draw();
    await user().click(screen.getByRole("button", { name: /^approve$/i }));
    expect(await screen.findByText(/estimate approved — thank you/i)).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the client on step 1 and says why when the signature is refused", async () => {
    const onSign = vi.fn(async () => {
      throw new Error("This estimate is already declined");
    });
    render(<SignAndPayPanel doc={estimate} mode="approve" signerName="Jane" onSign={onSign} onClose={vi.fn()} />);
    await draw();
    await user().click(screen.getByRole("button", { name: /^approve$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/already declined/i);
    expect(screen.queryByText(/thank you/i)).toBeNull();
  });

  it("an invoice signed earlier skips straight to paying", async () => {
    render(
      <SignAndPayPanel
        doc={{ kind: "invoice", id: "d2", number: "1043", date: "2026-09-28", status: "due", total: 300, balanceDue: 120.5, sent: true, payable: true }}
        mode="sign-invoice"
        signerName="Jane"
        onSign={vi.fn()}
        alreadySigned
        payment={{ loaders: { ...loaders, getOptions: vi.fn(async () => ({ ...depositOptions, invoiceId: "d2", number: "1043", amountDue: 120.5, allowPartial: true })) }, returnUrl: () => "x", noun: "invoice", onPaid: vi.fn() }}
        onClose={vi.fn()}
      />,
    );
    expect(await screen.findByLabelText(/amount to pay/i)).toHaveValue("120.50");
    expect(screen.queryByRole("img", { name: /sign here/i })).toBeNull();
  });
});
