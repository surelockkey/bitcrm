import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaymentTerms } from "@bitcrm/types";
import type { Contact, InvoiceView } from "@bitcrm/types";
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
 * A client invoice's page appears once, whole.
 *
 * It drew the invoice the moment it answered and let the rest fill in: "the
 * client" until the contact came, "Loading…" in the Template and Tax
 * pickers, a grey block where the payments go. And for a job's invoice — a
 * page that only forwards to the job — it still asked for the client first.
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

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 10 },
  { match: /\/billing\/invoices\/inv-9$/, reply: () => invoice({}), delayMs: 20 },
  { match: /\/billing\/invoices\/d1$/, reply: () => invoice({ id: "d1", dealId: "d1", number: "1042" }), delayMs: 20 },
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
      () => !!screen.queryByText(/Invoice #1001/),
      () => ({
        client: !!screen.queryByRole("link", { name: "Jane Client" }),
        payments: !!screen.queryByText("No payments on this invoice yet."),
        pickersLoading: screen.queryAllByText("Loading…").length,
        skeletons: skeletonCount(),
        asked: server.requests.length,
      }),
    );
    renderPage("inv-9");
    await screen.findByText(/Invoice #1001/, {}, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({ client: true, payments: true, pickersLoading: 0, skeletons: 0 });
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("sends a job's invoice to its job without asking for anything it will not show", async () => {
    renderPage("d1");
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/deals/d1?tab=invoice"));
    await settle();

    expect(server.requests.filter((r) => !/\/users\/me$|\/billing\/invoices\/d1$/.test(r))).toEqual([]);
  });
});
