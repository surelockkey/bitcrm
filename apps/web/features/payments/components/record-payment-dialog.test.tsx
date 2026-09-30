import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { RecordPaymentDialog } from "./record-payment-dialog";

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
let posted: Record<string, unknown> | undefined;

function handlers(over: { status?: number; message?: string } = {}) {
  server.use(
    http.post("*/billing/invoices/d1/payments", async ({ request }) => {
      posted = (await request.json()) as Record<string, unknown>;
      if (over.status && over.status >= 400) {
        return HttpResponse.json(
          { success: false, message: over.message ?? "Nope" },
          { status: over.status },
        );
      }
      return HttpResponse.json({
        success: true,
        data: { id: "p9", amount: posted.amount, method: posted.method, status: "settled" },
      });
    }),
  );
}

function open(balanceDue = 240.5) {
  const onOpenChange = vi.fn();
  renderWithClient(
    <RecordPaymentDialog
      invoiceId="d1"
      dealId="d1"
      balanceDue={balanceDue}
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

describe("RecordPaymentDialog", () => {
  it("opens with the balance due and today's date filled in", async () => {
    open();
    expect(await screen.findByLabelText("Amount")).toHaveValue("240.50");
    expect(screen.getByLabelText("Date received")).toHaveValue(
      new Date().toISOString().slice(0, 10),
    );
  });

  it("records a cheque with its number and a note", async () => {
    const u = user();
    const { onOpenChange } = open();
    await u.clear(await screen.findByLabelText("Amount"));
    await u.type(screen.getByLabelText("Amount"), "125.50");
    await u.click(screen.getByLabelText("Method"));
    await u.click(await screen.findByRole("option", { name: "Check" }));
    await u.type(screen.getByLabelText(/reference/i), "1042");
    await u.type(screen.getByLabelText(/note/i), "Left with the office");
    await u.click(screen.getByRole("button", { name: /record payment/i }));

    await waitFor(() => expect(posted).toBeTruthy());
    expect(posted).toMatchObject({
      amount: 125.5,
      method: "check",
      reference: "1042",
      note: "Left with the office",
    });
    expect(String(posted!.takenAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalled();
  });

  it("never offers bank — ACH money arrives through the portal, not the office", async () => {
    const u = user();
    open();
    await u.click(await screen.findByLabelText("Method"));
    expect(await screen.findByRole("option", { name: "Cash" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /bank/i })).toBeNull();
  });

  it("refuses an amount of zero without calling the API", async () => {
    const u = user();
    open();
    await u.clear(await screen.findByLabelText("Amount"));
    await u.type(screen.getByLabelText("Amount"), "0");
    await u.click(screen.getByRole("button", { name: /record payment/i }));
    expect(await screen.findByText(/greater than \$0\.00/i)).toBeInTheDocument();
    expect(posted).toBeUndefined();
  });

  it("keeps the dialog open and shows why when the server refuses", async () => {
    handlers({ status: 409, message: "That invoice is already paid in full" });
    const u = user();
    const { onOpenChange } = open();
    await u.click(await screen.findByRole("button", { name: /record payment/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already paid in full");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
