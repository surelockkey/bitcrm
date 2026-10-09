import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { PaymentTerms, type Deal, type DealProduct, type InvoiceView } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  products: [] as Partial<import("@bitcrm/types").DealProduct>[],
  perms: new Set(["invoices.view", "invoices.create", "invoices.edit", "invoices.send", "invoices.delete", "deals.edit"]),
  setTaxable: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/invoices/d1",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: (r: string, a = "view") => mocks.perms.has(`${r}.${a}`), isLoading: false }),
}));
// The job's items: answered; the server totals never asked for (the shared formula stands in).
const idle = { isLoading: false, isError: false, isPending: true, fetchStatus: "idle" as const };
vi.mock("@/features/deals/hooks", () => ({
  // The invoice's job, as the page asks for it once it knows the invoice is a job's.
  useDeal: (id: string) =>
    id ? { data: deal, isLoading: false, isError: false, isPending: false, fetchStatus: "idle" } : { data: undefined, ...idle },
  useDealProducts: () => ({ data: mocks.products, isLoading: false, isError: false, isPending: false, fetchStatus: "idle" }),
  useDealTotals: () => ({ data: undefined, ...idle }),
  useRemoveProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useSetProductTaxable: () => ({ mutate: mocks.setTaxable, isPending: false }),
  useSetDealTax: () => ({ mutate: vi.fn(), isPending: false }),
  useResetDealTax: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDealDiscount: () => ({ mutate: vi.fn(), isPending: false }),
}));
// The job's own item window (technicians, stock): a stand-in that says what it was opened on.
vi.mock("@/features/deals/components/add-product-dialog", () => ({
  AddProductDialog: ({ open, editing }: { open: boolean; editing?: { name: string } }) =>
    open ? <div role="dialog" aria-label={editing ? `Job item ${editing.name}` : "Job item new"} /> : null,
}));
vi.mock("@/features/deals/components/deal-attachments-tab", () => ({
  DealAttachmentsTab: ({ dealId }: { dealId: string }) => <section aria-label="Attachments" data-deal={dealId} />,
}));
vi.mock("@/features/deals/attachments-api", () => ({ listAttachments: () => Promise.resolve([]) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { StandaloneInvoicePage } from "./invoice-page";

const deal = {
  id: "d1",
  dealNumber: "1042",
  contactId: "c1",
  assignedTechIds: [],
  address: { street: "100 Park Blvd", city: "Austin", state: "TX", zip: "78701" },
} as unknown as Deal;
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
const product = (over: Partial<DealProduct> = {}): Partial<DealProduct> => ({
  lineId: "l1", productId: "p1", name: "Deadbolt", sku: "DB-1", quantity: 1, costCompany: 20, costForTech: 30,
  priceClient: 100, fulfillment: "sourced", taxable: true, addedBy: "u1", addedAt: "", ...over,
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  mocks.products = [];
  mocks.setTaxable.mockClear();
  mocks.push.mockClear();
  server.use(
    // The page learns from the invoice itself that it is a job's.
    http.get("*/billing/invoices/d1", () => HttpResponse.json({ success: true, data: invoice })),
    http.get("*/billing/templates", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/billing/document-settings", () => HttpResponse.json({ success: true, data: {} })),
    http.get("*/deals/tax-rates", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/crm/contacts/c1", () =>
      HttpResponse.json({
        success: true,
        data: {
          id: "c1", firstName: "Jane", lastName: "Client", phones: ["+15125550100"], emails: ["jane@client.test"], addresses: [],
          billingAddress: { street: "100 Park Blvd", city: "Austin", state: "TX", zip: "78701" },
        },
      }),
    ),
  );
});

/**
 * Workiz's invoice page for a job's invoice (pg_invoice_wz_01_partial,
 * /root/invoice/XYB3JT): its own page, "← Job ID" back to the job. Creating
 * one is the job page's "Create Invoice" (deal-detail-page.test.tsx).
 */
describe("a job's invoice on its own page", () => {
  beforeEach(() => {
    server.use(http.get("*/billing/invoices/by-deal/d1", () => HttpResponse.json({ success: true, data: invoice })));
  });

  it("heads it as Workiz does: ← Job ID, Client, Bill to, Service address, Invoice ID / date / Sent, and ours Status", async () => {
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    const header = await screen.findByRole("region", { name: "Invoice details" });
    // header-module__jobLink: first in the grey header, back to the job (its Details).
    const back = within(header).getByRole("link", { name: "Job ID: 1042" });
    expect(back).toHaveAttribute("href", "/deals/d1");
    expect(header.firstElementChild).toContainElement(back);
    expect(header).toHaveClass("pt-[22px]");
    expect(within(header).getByText("Client:")).toBeInTheDocument();
    expect(within(header).getByRole("link", { name: "Jane Client" })).toHaveAttribute("href", "/contacts/c1");
    expect(within(header).getByText("Bill to:").parentElement).toHaveTextContent("Jane Client100 Park BlvdAustin, TX 78701(512) 555-0100jane@client.test");
    // The job is where the client is billed.
    expect(within(header).getByText("Service address:").parentElement).toHaveTextContent("Same as billing address");
    expect(within(header).getByText("Invoice ID:").nextSibling).toHaveTextContent("1042");
    expect(screen.getByLabelText("Invoice date")).toHaveTextContent("9/16/2026");
    // Workiz: "Sent: No" in red until it goes out.
    expect(within(header).getByText("Sent:").nextSibling).toHaveTextContent("No");
    expect(within(header).getByText("Status:").nextSibling).toHaveTextContent("Due");
  });

  it("changes the invoice date from the calendar and moves the due date with the terms", async () => {
    let body: unknown;
    server.use(
      http.patch("*/billing/invoices/d1", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: invoice });
      }),
    );
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    const u = user();
    await u.click(await screen.findByLabelText("Invoice date"));
    await u.click(await screen.findByRole("button", { name: "Choose Sunday, September 20th, 2026" }));
    await waitFor(() => expect(body).toEqual({ invoiceDate: "2026-09-20", dueDate: "2026-10-05" }));
  });

  it("shows the job's items in Workiz's grid, opening the job's own item window", async () => {
    mocks.products = [product()];
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    expect(await screen.findByRole("heading", { name: "Items" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /deadbolt/i });
    expect(row).toHaveTextContent("$100.00");
    expect(within(row).getByText("Product")).toBeInTheDocument();
    const u = user();
    await u.click(within(row).getByRole("button", { name: "Edit Deadbolt" }));
    expect(screen.getByRole("dialog", { name: "Job item Deadbolt" })).toBeInTheDocument();
    // No reorder (a job's items keep their order) and no Price book on Workiz's invoice.
    expect(screen.queryByRole("button", { name: /reorder deadbolt/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /price book/i })).toBeNull();
  });

  it("totals as Workiz: Total, Balance, Due (set by the terms) and the terms beside it", async () => {
    mocks.products = [product()];
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    const balance = await screen.findByRole("group", { name: "Balance" });
    expect(balance).toHaveTextContent("Balance :100.00");
    expect(screen.getByRole("group", { name: "Due" })).toHaveTextContent("Due :10/1/2026");
    // Fixed terms own the due date: no calendar on it.
    expect(within(screen.getByRole("group", { name: "Due" })).queryByRole("button")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Payment terms" })).toHaveTextContent("Net 15");
  });

  it("marks the invoice sent from Actions (Workiz's 'Mark sent')", async () => {
    let body: unknown;
    server.use(
      http.post("*/billing/invoices/d1/mark-sent", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ...invoice, sentAt: "2026-09-16T11:00:00.000Z" } });
      }),
    );
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    await user().click(await screen.findByRole("button", { name: /^actions$/i }));
    await user().click(await screen.findByRole("menuitem", { name: "Mark sent" }));
    await waitFor(() => expect(body).toEqual({ sent: true }));
  });

  // pg_invoice_wz_05_actions_open: "View job" heads Workiz's Actions on a job's invoice.
  it("heads Actions with Workiz's 'View job', which opens the job", async () => {
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    await user().click(await screen.findByRole("button", { name: /^actions$/i }));
    const rows = await screen.findAllByRole("menuitem");
    expect(rows[0]).toHaveTextContent("View job");
    await user().click(rows[0]);
    expect(mocks.push).toHaveBeenCalledWith("/deals/d1");
  });

  it("offers Send only to someone who may both send invoices and send messages", async () => {
    const { unmount } = renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    await screen.findByRole("region", { name: "Invoice details" });
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    unmount();

    mocks.perms.add("messages.send");
    try {
      renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
      expect(await screen.findByRole("button", { name: /^send$/i })).toBeInTheDocument();
    } finally {
      mocks.perms.delete("messages.send");
    }
  });

  it("Send opens the Workiz-style panel with both Send email and Send text", async () => {
    mocks.perms.add("messages.send");
    server.use(
      http.get("*/billing/business-profiles", () => HttpResponse.json({ success: true, data: [] })),
      http.post("*/billing/portal-links/c1/url", () =>
        HttpResponse.json({ success: true, data: { contactId: "c1", createdBy: "u", createdAt: "t", url: "https://portal.test/tok", token: "tok" } }),
      ),
    );
    try {
      renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
      await user().click(await screen.findByRole("button", { name: /^send$/i }));
      expect(await screen.findByRole("heading", { name: /send invoice #1042/i })).toBeInTheDocument();
      expect(await screen.findByRole("button", { name: /^send email$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^send text$/i })).toBeInTheDocument();
    } finally {
      mocks.perms.delete("messages.send");
    }
  });

  it("shows Notes with Workiz's (+Add), Signatures with Sign, and the job's Attachments", async () => {
    let body: unknown;
    server.use(
      http.patch("*/billing/invoices/d1", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: { ...invoice, notes: "Thanks!" } });
      }),
    );
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    expect(await screen.findByRole("heading", { name: "Signatures" })).toBeInTheDocument();
    expect(screen.getByText("No signatures found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^sign$/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Attachments" })).toHaveAttribute("data-deal", "d1");

    const u = user();
    await u.click(screen.getByRole("button", { name: "(+Add)" }));
    await u.type(screen.getByRole("textbox", { name: "Invoice notes" }), "Thanks!");
    screen.getByRole("textbox", { name: "Invoice notes" }).blur();
    await waitFor(() => expect(body).toEqual({ notes: "Thanks!" }));
  });

  it("explains that deleting keeps the job's items, and goes back to the job once it is gone", async () => {
    server.use(http.delete("*/billing/invoices/d1", () => HttpResponse.json({ success: true, data: { deleted: true } })));
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    await user().click(await screen.findByRole("button", { name: /^actions$/i }));
    await user().click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText(/items stay on the job/i)).toBeInTheDocument();
    await user().click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/deals/d1"));
  });
});

describe("a job's invoice — the payment ledger", () => {
  beforeEach(() => {
    mocks.products = [product()];
    server.use(
      http.get("*/billing/invoices/by-deal/d1", () => HttpResponse.json({ success: true, data: invoice })),
      http.get("*/billing/deals/d1/payment-schedule", () => HttpResponse.json({ success: true, data: null })),
      http.get("*/billing/invoices/d1/payments", () =>
        HttpResponse.json({
          success: true,
          data: {
            payments: [
              {
                id: "p1", invoiceId: "d1", dealId: "d1", contactId: "c1", amount: 40,
                currency: "usd", method: "cash", status: "settled", refundedAmount: 0,
                source: "field", takenBy: "u1", takenAt: "2026-09-20T15:00:00.000Z",
                version: 1, createdAt: "2026-09-20T15:00:00.000Z", updatedAt: "2026-09-20T15:00:00.000Z",
              },
            ],
            summary: { settled: 40, pending: 0, refunded: 0, paymentCount: 1, hasPending: false },
          },
        }),
      ),
    );
    mocks.perms.add("payments.view");
    mocks.perms.add("payments.collect");
  });

  afterEach(() => {
    mocks.perms.delete("payments.view");
    mocks.perms.delete("payments.collect");
  });

  it("renders Payments beside Notes and takes the ledger off the Balance", async () => {
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    expect(await screen.findByRole("heading", { name: "Payments" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("group", { name: "Balance" })).toHaveTextContent("Balance :60.00"));
  });

  it("'Pay' beside the balance opens Record a payment for what is owed", async () => {
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    const balance = await screen.findByRole("group", { name: "Balance" });
    await waitFor(() => expect(balance).toHaveTextContent("60.00"));
    await user().click(within(balance).getByRole("button", { name: "Pay" }));
    expect(await screen.findByLabelText("Amount")).toHaveValue("60.00");
  });

  it("marks a part-paid invoice beside its status, which stays Due", async () => {
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    const header = await screen.findByRole("region", { name: "Invoice details" });
    await waitFor(() => expect(within(header).getByText("Status:").nextSibling).toHaveTextContent("Due · Partially paid"));
  });

  it("offers Workiz's 'Add payment schedule' and opens its window", async () => {
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    await user().click(await screen.findByRole("button", { name: "Add payment schedule" }));
    expect(await screen.findByRole("dialog", { name: "Add payment schedule" })).toBeInTheDocument();
  });

  it("shows the job's schedule under the totals instead, once it has one", async () => {
    server.use(
      http.get("*/billing/deals/d1/payment-schedule", () =>
        HttpResponse.json({
          success: true,
          data: {
            dealId: "d1", method: "percent", total: 100, amountPaid: 40, balanceDue: 60, updatedAt: "",
            lines: [
              { id: "s1", index: 1, percent: 50, amount: 50, paid: 40, remaining: 10, dueDate: "2026-09-20", status: "overdue" },
              { id: "s2", index: 2, percent: 50, amount: 50, paid: 0, remaining: 50, dueDate: "2026-10-20", status: "future" },
            ],
          },
        }),
      ),
    );
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    expect(await screen.findByRole("heading", { name: "Payment schedule" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add payment schedule" })).toBeNull();
  });

  it("shows nothing about payments to someone without payments.view", async () => {
    mocks.perms.delete("payments.view");
    mocks.perms.delete("payments.collect");
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    await screen.findByRole("region", { name: "Invoice details" });
    expect(screen.queryByRole("heading", { name: "Payments" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add payment schedule" })).toBeNull();
  });
});
