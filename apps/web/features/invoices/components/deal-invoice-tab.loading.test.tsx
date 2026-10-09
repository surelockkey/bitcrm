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
 * A job's Invoice tab appears once, whole.
 *
 * The invoice list opens a job on this tab. The invoice itself came with the
 * job page, but the tab then filled in under the reader: "Loading…" in the
 * Template picker, a grey block where the job's items go, another where the
 * payments go — and as each landed the Payments and Signatures sections
 * below were pushed down (CLS 0.04 on dev).
 *
 * Now the tab asks for everything it shows the moment it opens and draws it
 * in one frame.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/deals/d1",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const totals = {
  lineCount: 1, subtotal: 80, taxableSubtotal: 80, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 80, taxRatePercent: 0, tax: 0, total: 80, amountPaid: 0, balanceDue: 80,
};

const deal: Deal = {
  id: "d1", dealNumber: "1042", contactId: "c1", clientType: ClientType.RESIDENTIAL, serviceArea: "North",
  address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" }, jobTypeId: "jt-1",
  superStatus: JobSuperStatus.SUBMITTED, assignedDispatcherId: "u1", priority: DealPriority.NORMAL,
  assignedTechIds: [], tagIds: [], status: DealStatus.ACTIVE, itemCount: 1, createdBy: "u1", createdAt: "", updatedAt: "",
};

const invoice: InvoiceView = {
  id: "inv-1", number: "1042", dealId: "d1", contactId: "c1", invoiceDate: "2026-09-16",
  paymentTerms: PaymentTerms.NET_15, dueDate: "2026-10-01", status: "due", totals, version: 1,
  createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "2026-09-16T10:00:00.000Z", items: [],
};

const contact = { id: "c1", firstName: "Jane", lastName: "Client", phones: [], emails: [], addresses: [] } as unknown as Contact;

const line = {
  lineId: "l1", productId: "p1", name: "Deadbolt", sku: "DB", quantity: 1, priceClient: 80, costCompany: 10,
  costForTech: 20, taxable: true,
};

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 10 },
  { match: /\/billing\/invoices\/by-deal\/d1$/, reply: () => invoice, delayMs: 20 },
  // What the tab shows under the invoice, in the order dev answers it.
  { match: /\/billing\/templates$/, reply: () => [{ id: "t1", kind: "invoice", name: "Classic", isDefault: true }], delayMs: 30 },
  { match: /\/deals\/d1\/products$/, reply: () => [line], delayMs: 40 },
  { match: /\/deals\/d1\/totals$/, reply: () => totals, delayMs: 50 },
  { match: /\/billing\/invoices\/inv-1\/payments$/, reply: () => ({ payments: [], summary: { settled: 0, pending: 0, refunded: 0, paymentCount: 0, hasPending: false } }), delayMs: 60 },
  { match: /\/deals\/tax-rates$/, reply: () => [], delayMs: 30 },
  { match: /\/crm\/contacts\/c1$/, reply: () => contact, delayMs: 20 },
  // Workiz's invoice page also shows the job's payment schedule (or "Add payment schedule") and the job's files.
  { match: /\/billing\/deals\/d1\/payment-schedule$/, reply: () => null, delayMs: 70 },
  { match: /\/deals\/d1\/attachments$/, reply: () => [], delayMs: 80 },
];

let server: FakeServer;

const { DealInvoiceTab } = await import("./deal-invoice-tab");

/**
 * With the app's own query defaults (app/providers.tsx): the job page has
 * already asked for what it shows, and a block mounting under it finds those
 * answers fresh rather than asking again.
 */
function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <DealInvoiceTab deal={deal} canEditItems />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DealInvoiceTab — no jumping", () => {
  it("draws the invoice, the job's items, the payments, the schedule, the files and the pickers in one frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Invoice ID:"),
      () => ({
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
    renderTab();
    await screen.findByText("Invoice ID:", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({ client: true, items: true, payments: true, schedule: true, files: true, pickersLoading: 0, skeletons: 0 });
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });
});
