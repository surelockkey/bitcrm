import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientType, DealPriority, DealStatus, JobSuperStatus, PaymentTerms } from "@bitcrm/types";
import type { Contact, Deal, InvoiceView } from "@bitcrm/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  duplicates,
  installFakeServer,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";

/**
 * An invoice's page appears once, whole.
 *
 * It drew the invoice the moment it answered and let the rest fill in: "the
 * client" until the contact came, "Loading…" in the Template and Tax
 * pickers, a grey block where the payments go. A job's invoice lives here too
 * now (it was the job page's Invoice tab, which had the same trouble: the
 * job's items, payments, schedule and files each filling in under it).
 */

const mocks = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, prefetch: vi.fn() }),
  usePathname: () => "/invoices/inv-9",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const totals = {
  lineCount: 0, subtotal: 0, taxableSubtotal: 0, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 0, taxRatePercent: 0, tax: 0, total: 0, amountPaid: 0, balanceDue: 0,
};
const invoice = (over: Partial<InvoiceView>): InvoiceView => ({
  id: "inv-9", number: "1001", contactId: "c1", invoiceDate: "2026-09-16", paymentTerms: PaymentTerms.NET_15,
  dueDate: "2026-10-01", status: "due", totals, version: 1, createdBy: "u1",
  createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z", items: [], ...over,
});

const contact = { id: "c1", firstName: "Jane", lastName: "Client", phones: [], emails: [], addresses: [] } as unknown as Contact;

const jobTotals = { ...totals, lineCount: 1, subtotal: 80, taxableSubtotal: 80, taxableBase: 80, total: 80, balanceDue: 80 };
const jobInvoice = invoice({ id: "d1", dealId: "d1", number: "1042", totals: jobTotals });
const deal: Deal = {
  id: "d1", dealNumber: "1042", contactId: "c1", clientType: ClientType.RESIDENTIAL, serviceArea: "North",
  address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" }, jobTypeId: "jt-1",
  superStatus: JobSuperStatus.SUBMITTED, assignedDispatcherId: "u1", priority: DealPriority.NORMAL,
  assignedTechIds: [], tagIds: [], status: DealStatus.ACTIVE, itemCount: 1, createdBy: "u1", createdAt: "", updatedAt: "",
};
const line = {
  lineId: "l1", productId: "p1", name: "Deadbolt", sku: "DB", quantity: 1, priceClient: 80, costCompany: 10,
  costForTech: 20, taxable: true,
};
const noPayments = { payments: [], summary: { settled: 0, pending: 0, refunded: 0, paymentCount: 0, hasPending: false } };

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 10 },
  { match: /\/billing\/invoices\/inv-9$/, reply: () => invoice({}), delayMs: 20 },
  { match: /\/billing\/invoices\/d1$/, reply: () => jobInvoice, delayMs: 20 },
  // A job's invoice: the job's slot (where its edits land), the job, and what the job brings to it.
  { match: /\/billing\/invoices\/by-deal\/d1$/, reply: () => jobInvoice, delayMs: 20 },
  { match: /\/deals\/d1$/, reply: () => deal, delayMs: 30 },
  { match: /\/deals\/d1\/products$/, reply: () => [line], delayMs: 40 },
  { match: /\/deals\/d1\/totals$/, reply: () => jobTotals, delayMs: 50 },
  { match: /\/billing\/invoices\/d1\/payments$/, reply: () => noPayments, delayMs: 60 },
  { match: /\/billing\/deals\/d1\/payment-schedule$/, reply: () => null, delayMs: 70 },
  { match: /\/deals\/d1\/attachments$/, reply: () => [], delayMs: 80 },
  { match: /\/crm\/contacts\/c1$/, reply: () => contact, delayMs: 50 },
  { match: /\/billing\/invoices\/inv-9\/payments$/, reply: () => ({ payments: [], summary: { settled: 0, pending: 0, refunded: 0, paymentCount: 0, hasPending: false } }), delayMs: 60 },
  { match: /\/billing\/templates$/, reply: () => [{ id: "t1", kind: "invoice", name: "Classic", isDefault: true }], delayMs: 30 },
  { match: /\/deals\/tax-rates$/, reply: () => [], delayMs: 30 },
];

let server: FakeServer;

const { StandaloneInvoicePage } = await import("./invoice-page");

/** With the app's own query defaults (app/providers.tsx). */
function renderPage(invoiceId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <StandaloneInvoicePage invoiceId={invoiceId} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.replace.mockClear();
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StandaloneInvoicePage — no jumping", () => {
  it("draws a client invoice with its client, payments and pickers in one frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Invoice ID:"),
      () => ({
        client: !!screen.queryByRole("link", { name: "Jane Client" }),
        payments: !!screen.queryByText("No payments on this invoice yet."),
        pickersLoading: screen.queryAllByText("Loading…").length,
        skeletons: skeletonCount(),
        asked: server.requests.length,
      }),
    );
    renderPage("inv-9");
    await screen.findByText("Invoice ID:", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({ client: true, payments: true, pickersLoading: 0, skeletons: 0 });
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("draws a job's invoice with ← Job ID, the job's items, payments, schedule, files and pickers in one frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Invoice ID:"),
      () => ({
        jobLink: !!screen.queryByRole("link", { name: "Job ID: 1042" }),
        client: screen.queryAllByText(/Jane Client/).length > 0,
        items: !!screen.queryByText("Deadbolt"),
        payments: !!screen.queryByRole("button", { name: "Add payments" }),
        schedule: !!screen.queryByRole("button", { name: "Add payment schedule" }),
        files: !!screen.queryByText(/upload files/i),
        pickersLoading: screen.queryAllByText("Loading…").length,
        skeletons: skeletonCount(),
        asked: server.requests.length,
      }),
    );
    renderPage("d1");
    await screen.findByText("Invoice ID:", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({
      jobLink: true, client: true, items: true, payments: true, schedule: true, files: true, pickersLoading: 0, skeletons: 0,
    });
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
