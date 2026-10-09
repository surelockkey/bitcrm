import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { PaymentScheduleView } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { AddPaymentScheduleButton, PaymentScheduleDialog, PaymentScheduleTable } from "./payment-schedule";

const view: PaymentScheduleView = {
  dealId: "d1",
  method: "percent",
  total: 584.93,
  amountPaid: 100,
  balanceDue: 484.93,
  updatedAt: "",
  lines: [
    { id: "p1", index: 1, percent: 50, amount: 292.47, paid: 100, remaining: 192.47, dueDate: "2026-10-06", note: "Initial payment", status: "due" },
    { id: "p2", index: 2, percent: 50, amount: 292.46, paid: 0, remaining: 292.46, dueDate: "2026-10-20", status: "future" },
  ],
};

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
});

/** hc-38044340324753-03/-07: the schedule under the totals once a job has one. */
describe("PaymentScheduleTable", () => {
  function render(over: Partial<React.ComponentProps<typeof PaymentScheduleTable>> = {}) {
    const props = {
      view,
      invoiceId: "d1",
      canEdit: true,
      canCollect: true,
      canViewPdf: true,
      onEdit: vi.fn(),
      ...over,
    };
    renderWithClient(<PaymentScheduleTable {...props} />);
    return props;
  }

  it("lists each payment: number, amount (what is paid of it), tag, due date and note, under the remaining balance", () => {
    render();
    expect(screen.getByRole("heading", { name: "Payment schedule" })).toBeInTheDocument();
    expect(screen.getByText("Remaining balance:").parentElement).toHaveTextContent("Remaining balance: $484.93");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("1.");
    expect(rows[0]).toHaveTextContent("$292.47(paid $100.00)");
    expect(rows[0]).toHaveTextContent("Partial");
    expect(rows[0]).toHaveTextContent("Oct 6, 2026");
    expect(rows[0]).toHaveTextContent("Initial payment");
    expect(rows[1]).toHaveTextContent("$292.46");
    expect(rows[1]).toHaveTextContent("Future");
  });

  it("Edit schedule opens the window; Delete schedule removes it after asking", async () => {
    let deleted = false;
    server.use(
      http.delete("*/billing/deals/d1/payment-schedule", () => {
        deleted = true;
        return HttpResponse.json({ success: true, data: { deleted: true } });
      }),
    );
    const props = render();
    const u = user();
    await u.click(screen.getByRole("button", { name: "Edit schedule" }));
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    await u.click(screen.getByRole("button", { name: "Delete schedule" }));
    await u.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleted).toBe(true));
  });

  it("takes a payment for what is left of one scheduled payment", async () => {
    render();
    await user().click(screen.getByRole("button", { name: "Add payment for payment 1" }));
    const dialog = await screen.findByRole("dialog", { name: /record a payment/i });
    expect(within(dialog).getByLabelText(/amount/i)).toHaveValue("192.47");
  });

  it("shows a reader the schedule without Edit, Delete or Add payment", () => {
    render({ canEdit: false, canCollect: false });
    expect(screen.queryByRole("button", { name: "Edit schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete schedule" })).toBeNull();
    expect(screen.queryByRole("button", { name: /add payment for/i })).toBeNull();
    expect(screen.getByRole("button", { name: "View payment 1" })).toBeInTheDocument();
  });
});

describe("AddPaymentScheduleButton", () => {
  it("is Workiz's grey '+ Add payment schedule' box", async () => {
    const onClick = vi.fn();
    renderWithClient(<AddPaymentScheduleButton onClick={onClick} />);
    await user().click(screen.getByRole("button", { name: "Add payment schedule" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

/** hc-38044340324753-02 / -08: "Add payment schedule" / "Edit payment schedule". */
describe("PaymentScheduleDialog", () => {
  it("starts as two halves, sums the draft up, and saves it", async () => {
    let body: unknown;
    server.use(
      http.put("*/billing/deals/d1/payment-schedule", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: view });
      }),
    );
    const onOpenChange = vi.fn();
    renderWithClient(
      <PaymentScheduleDialog open onOpenChange={onOpenChange} dealId="d1" total={500} amountPaid={0} view={null} today="2026-10-06" />,
    );
    const dialog = screen.getByRole("dialog", { name: "Add payment schedule" });
    expect(within(dialog).getByText("Remaining").parentElement).toHaveTextContent("$500.00");
    expect(within(dialog).getByText("Next due").parentElement).toHaveTextContent("$250.00|on 10/06/2026");
    expect(within(dialog).getByText("2 payments")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Payment 1")).toHaveValue("50");
    expect(within(dialog).getByLabelText("Payment 2")).toHaveValue("50");

    await user().click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(body).toEqual({
        method: "percent",
        entries: [
          { percent: 50, dueDate: "2026-10-06" },
          { percent: 50, dueDate: "2026-10-07" },
        ],
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("adds a payment, switches to $ and says why it cannot save yet", async () => {
    renderWithClient(
      <PaymentScheduleDialog open onOpenChange={vi.fn()} dealId="d1" total={300} amountPaid={0} view={null} today="2026-10-06" />,
    );
    const u = user();
    await u.click(screen.getByRole("button", { name: "Add payment" }));
    expect(screen.getByLabelText("Payment 3")).toHaveValue("33.34");
    await u.click(screen.getByRole("radio", { name: "$" }));
    expect(screen.getByLabelText("Payment 1")).toHaveValue("99.99");
    await u.clear(screen.getByLabelText("Payment 1"));
    await u.type(screen.getByLabelText("Payment 1"), "10");
    expect(screen.getByRole("alert")).toHaveTextContent("The payments add up to $210.01 — they must make the job total, $300.00");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("opens an existing schedule as 'Edit payment schedule' with its payments", () => {
    renderWithClient(
      <PaymentScheduleDialog open onOpenChange={vi.fn()} dealId="d1" total={584.93} amountPaid={100} view={view} today="2026-10-06" />,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit payment schedule" });
    expect(within(dialog).getByLabelText("Note 1")).toHaveValue("Initial payment");
    // Nothing covered in full yet: "2 payments" (Workiz writes "1/3 payments" once one is paid).
    expect(within(dialog).getByText("2 payments")).toBeInTheDocument();
  });
});
