import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { PaymentTerms, type InvoiceView } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), dealMissing: false }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/invoices/inv-9",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("@/features/clients/hooks", () => ({
  useContact: () => ({ data: { id: "c1", firstName: "Jane", lastName: "Client", phones: [], emails: [], addresses: [] } }),
}));
vi.mock("@/features/deals/hooks", () => ({
  // A job invoice's job (the page asks for it once it knows the invoice is a job's).
  useDeal: (id: string) =>
    mocks.dealMissing
      ? { data: undefined, isError: true, isPending: false, fetchStatus: "idle" }
      : id
        ? {
            data: { id, dealNumber: "1042", contactId: "c1", assignedTechIds: [], address: { street: "9 Elm St", city: "Austin", state: "TX", zip: "78701" } },
            isError: false,
            isPending: false,
            fetchStatus: "idle",
          }
        : { data: undefined, isError: false, isPending: true, fetchStatus: "idle" },
  useDealProducts: () => ({ data: [], isLoading: false, isError: false, isPending: false, fetchStatus: "idle" }),
  useDealTotals: () => ({ data: undefined, isLoading: false, isError: false, isPending: true, fetchStatus: "idle" }),
  useRemoveProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useSetProductTaxable: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDealTax: () => ({ mutate: vi.fn(), isPending: false }),
  useResetDealTax: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDealDiscount: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/deals/attachments-api", () => ({ listAttachments: () => Promise.resolve([]) }));
// The job's own item window (technicians, stock) has its own tests.
vi.mock("@/features/deals/components/add-product-dialog", () => ({ AddProductDialog: () => null }));
vi.mock("@/features/deals/components/deal-attachments-tab", () => ({
  DealAttachmentsTab: () => <section aria-label="Attachments" />,
}));
vi.mock("@/features/payments/schedule-hooks", () => ({
  usePaymentSchedule: () => ({ data: undefined, isError: false, isPending: true, fetchStatus: "idle" }),
  useRefreshScheduleOnTotal: () => {},
}));
vi.mock("@/features/payments/hooks", () => ({
  // Never asked here (the payments section is a stub): the page does not wait on it.
  useInvoicePayments: () => ({ data: undefined, isError: false, isPending: true, fetchStatus: "idle" }),
  useSetAllowedMethods: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/payments/components/invoice-payments-section", () => ({
  InvoicePaymentsSection: () => <div data-testid="payments-section" />,
}));
vi.mock("@/features/billing/components/document-summary-panel", () => ({
  DocumentSummaryPanel: ({ totals, canEdit }: { totals: { total: number }; canEdit: boolean }) => (
    <div data-testid="summary" data-can-edit={String(canEdit)}>{totals.total}</div>
  ),
}));
// The catalog picker pulls the whole product list; here it just hands back a line.
vi.mock("@/features/billing/components/product-picker-dialog", () => ({
  ProductPickerDialog: ({ open, onSubmit }: { open: boolean; onSubmit: (b: unknown) => void }) =>
    open ? (
      <button
        type="button"
        onClick={() =>
          onSubmit({ productId: "p1", name: "Deadbolt", sku: "DB", quantity: 1, priceClient: 80, costCompany: 10, costForTech: 20 })
        }
      >
        Pick Deadbolt
      </button>
    ) : null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { usePageHistoryStore } from "@/stores/page-history-store";
import { StandaloneInvoicePage } from "./invoice-page";

const totals = {
  lineCount: 0, subtotal: 0, taxableSubtotal: 0, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 0, taxRatePercent: 0, tax: 0, total: 0, amountPaid: 0, balanceDue: 0,
};
const invoice = (over: Partial<InvoiceView> = {}): InvoiceView => ({
  id: "inv-9", number: "1001", contactId: "c1", invoiceDate: "2026-09-16", paymentTerms: PaymentTerms.NET_30,
  dueDate: "2026-10-16", status: "no_amount", totals, version: 1, createdBy: "u1",
  createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z", items: [], ...over,
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  mocks.replace.mockClear();
  server.use(http.get("*/billing/templates", () => HttpResponse.json({ success: true, data: [] })));
});

/** Workiz: a client's invoice (no job) opens on its own page with its own lines. */
describe("StandaloneInvoicePage", () => {
  it("edits a client invoice's own lines instead of a job's items", async () => {
    let body: unknown;
    server.use(
      http.get("*/billing/invoices/inv-9", () => HttpResponse.json({ success: true, data: invoice() })),
      http.post("*/billing/invoices/inv-9/items", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: true, data: invoice() });
      }),
    );
    renderWithClient(<StandaloneInvoicePage invoiceId="inv-9" />);
    // pg_invoice_wz_04_nojob: Workiz's header straight under the breadcrumb — "Client:", no job, no service address.
    const header = await screen.findByRole("region", { name: "Invoice details" });
    expect(within(header).getByText("Invoice ID:").nextSibling).toHaveTextContent("1001");
    expect(within(header).getByRole("link", { name: /Jane Client/ })).toHaveAttribute("href", "/contacts/c1");
    expect(within(header).queryByText("Service address:")).toBeNull();
    expect(screen.queryByText(/not tied to a job/i)).toBeNull();
    // The breadcrumb names it as Workiz's does: "INVOICE (1001)".
    expect(usePageHistoryStore.getState().labels["/invoices/inv-9"]).toBe("Invoice (1001)");
    // Its own lines: Workiz's empty grid says "Add line items"; no job, so no job files.
    expect(screen.getByRole("button", { name: "Add line items" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Attachments" })).toBeNull();
    // Its own tax and discount, editable here (a job invoice's are the job's).
    expect(screen.getByTestId("summary")).toHaveAttribute("data-can-edit", "true");

    const u = user();
    await u.click(screen.getByRole("button", { name: /^add item$/i }));
    await u.click(await screen.findByRole("button", { name: "Pick Deadbolt" }));
    await waitFor(() => expect(body).toMatchObject({ productId: "p1", name: "Deadbolt", quantity: 1, priceClient: 80 }));
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  // Workiz opens a job's invoice on its own page too (/root/invoice/XYB3JT, from
  // the job's "View Invoice"): "← Job ID: XYB3JT" in the grey header, back to
  // the job (pg_invoice_wz_01_partial).
  it("opens a job's invoice here, with ← Job ID back to the job in its header", async () => {
    const jobInvoice = invoice({ id: "d1", number: "1042", dealId: "d1" });
    server.use(
      http.get("*/billing/invoices/d1", () => HttpResponse.json({ success: true, data: jobInvoice })),
      http.get("*/billing/invoices/by-deal/d1", () => HttpResponse.json({ success: true, data: jobInvoice })),
    );
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    const header = await screen.findByRole("region", { name: "Invoice details" });
    expect(within(header).getByRole("link", { name: "Job ID: 1042" })).toHaveAttribute("href", "/deals/d1");
    // It is the job's: its service address, its files.
    expect(within(header).getByText("Service address:")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Attachments" })).toBeInTheDocument();
    expect(usePageHistoryStore.getState().labels["/invoices/inv-9"]).toBe("Invoice (1042)");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("says so when the job behind the invoice cannot be loaded", async () => {
    mocks.dealMissing = true;
    const jobInvoice = invoice({ id: "d1", number: "1042", dealId: "d1" });
    server.use(
      http.get("*/billing/invoices/d1", () => HttpResponse.json({ success: true, data: jobInvoice })),
      http.get("*/billing/invoices/by-deal/d1", () => HttpResponse.json({ success: true, data: jobInvoice })),
    );
    try {
      renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
      expect(await screen.findByText(/this invoice's job couldn't be loaded/i)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /^job id/i })).toBeNull();
    } finally {
      mocks.dealMissing = false;
    }
  });
});
