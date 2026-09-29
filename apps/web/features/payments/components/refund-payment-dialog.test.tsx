import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Payment } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { RefundPaymentDialog } from "./refund-payment-dialog";

const payment: Payment = {
  id: "p1",
  invoiceId: "d1",
  dealId: "d1",
  contactId: "c1",
  amount: 200,
  currency: "usd",
  method: "card",
  status: "settled",
  refundedAmount: 50,
  source: "portal",
  takenBy: "client",
  takenAt: "2026-09-20T15:00:00.000Z",
  version: 1,
  createdAt: "2026-09-20T15:00:00.000Z",
  updatedAt: "2026-09-20T15:00:00.000Z",
};

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
let posted: Record<string, unknown> | undefined;

function handlers(over: { status?: number; message?: string } = {}) {
  server.use(
    http.post("*/billing/payments/p1/refund", async ({ request }) => {
      posted = (await request.json()) as Record<string, unknown>;
      if (over.status && over.status >= 400) {
        return HttpResponse.json(
          { success: false, message: over.message ?? "Nope" },
          { status: over.status },
        );
      }
      return HttpResponse.json({
        success: true,
        data: { id: "r1", paymentId: "p1", amount: posted.amount, status: "succeeded" },
      });
    }),
  );
}

function open(over: Partial<Payment> = {}) {
  const onOpenChange = vi.fn();
  renderWithClient(
    <RefundPaymentDialog
      payment={{ ...payment, ...over }}
      invoiceId="d1"
      dealId="d1"
      open
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  posted = undefined;
  toast.success.mockClear();
  toast.error.mockClear();
  handlers();
});

describe("RefundPaymentDialog", () => {
  it("defaults to everything still refundable and says what that is", async () => {
    open();
    expect(await screen.findByLabelText("Refund amount")).toHaveValue("150.00");
    expect(screen.getByText(/\$150\.00 of the \$200\.00 can still be refunded/i)).toBeInTheDocument();
  });

  it("sends a partial refund with a reason and the receipt asked for", async () => {
    const u = user();
    const { onOpenChange } = open();
    await u.clear(await screen.findByLabelText("Refund amount"));
    await u.type(screen.getByLabelText("Refund amount"), "25");
    await u.type(screen.getByLabelText(/reason/i), "Returned the part");
    await u.click(screen.getByRole("button", { name: /^refund/i }));

    await waitFor(() => expect(posted).toBeTruthy());
    expect(posted).toEqual({ amount: 25, reason: "Returned the part", sendReceipt: true });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("can refund without emailing the client", async () => {
    const u = user();
    open();
    await u.click(await screen.findByLabelText(/email the client a receipt/i));
    await u.click(screen.getByRole("button", { name: /^refund/i }));
    await waitFor(() => expect(posted).toBeTruthy());
    expect(posted).toMatchObject({ sendReceipt: false });
  });

  it("refuses more than remains before it reaches the server", async () => {
    const u = user();
    open();
    await u.clear(await screen.findByLabelText("Refund amount"));
    await u.type(screen.getByLabelText("Refund amount"), "150.01");
    await u.click(screen.getByRole("button", { name: /^refund/i }));
    expect(await screen.findByText(/at most \$150\.00/i)).toBeInTheDocument();
    expect(posted).toBeUndefined();
  });

  it("stays open and repeats the server's reason when it refuses", async () => {
    handlers({ status: 409, message: "Stripe has already refunded this charge in full" });
    const u = user();
    const { onOpenChange } = open();
    await u.click(await screen.findByRole("button", { name: /^refund/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already refunded this charge");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("says so, and refuses to send, when nothing is left to refund", async () => {
    open({ refundedAmount: 200, status: "refunded" });
    expect(await screen.findByText(/nothing left to refund/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^refund/i })).toBeDisabled();
  });
});
