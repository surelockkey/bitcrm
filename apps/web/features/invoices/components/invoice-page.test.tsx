import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { PaymentTerms, type InvoiceView } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
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
  useDealProducts: () => ({ data: undefined, isLoading: false }),
  useDealTotals: () => ({ data: undefined, isLoading: false }),
}));
vi.mock("@/features/deals/components/deal-attachments-tab", () => ({
  DealAttachmentsTab: () => <section aria-label="Attachments" />,
}));
vi.mock("@/features/payments/schedule-hooks", () => ({
  usePaymentSchedule: () => ({ data: undefined, isError: false, isPending: true, fetchStatus: "idle" }),
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

  it("sends a job's invoice to the job's Invoice tab", async () => {
    server.use(
      http.get("*/billing/invoices/d1", () =>
        HttpResponse.json({ success: true, data: invoice({ id: "d1", number: "1042", dealId: "d1" }) }),
      ),
    );
    renderWithClient(<StandaloneInvoicePage invoiceId="d1" />);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/deals/d1?tab=invoice"));
  });
});
