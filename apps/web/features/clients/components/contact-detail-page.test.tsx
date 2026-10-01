import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Deal, Payment } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  perms: { allowed: new Set<string>(["*"]) },
  deals: { pages: [] as { data: Deal[] }[], hasNextPage: false, fetchNextPage: vi.fn(), isFetchingNextPage: false },
  payments: [] as Payment[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (r: string, a = "view") => mocks.perms.allowed.has("*") || mocks.perms.allowed.has(`${r}.${a}`) || mocks.perms.allowed.has(r),
  }),
  useDenied: () => (r: string, a = "view") => !(mocks.perms.allowed.has("*") || mocks.perms.allowed.has(`${r}.${a}`) || mocks.perms.allowed.has(r)),
}));
vi.mock("@/features/deals/hooks", () => ({
  useDealsPage: () => ({
    data: { pages: mocks.deals.pages },
    hasNextPage: mocks.deals.hasNextPage,
    fetchNextPage: mocks.deals.fetchNextPage,
    isFetchingNextPage: mocks.deals.isFetchingNextPage,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/features/invoices/hooks", () => ({
  useInvoicesForContacts: () => ({
    data: [
      { id: "i1", dealId: "d1", number: "D1", dueDate: "2026-09-01", status: "sent", totals: { total: 100, balanceDue: 100, amountPaid: 0 } },
      { id: "i2", dealId: "d2", number: "D2", dueDate: "2026-12-01", status: "sent", totals: { total: 250, balanceDue: 50, amountPaid: 200 } },
    ],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/features/estimates/hooks", () => ({
  useEstimatesForContacts: () => ({ data: [{ id: "e1" }, { id: "e2" }, { id: "e3" }], isLoading: false, isError: false }),
}));
vi.mock("@/features/job-types/lib", () => ({ useJobTypeName: () => (id?: string) => (id === "jt1" ? "Lock Repair" : "Unknown type") }));
vi.mock("@/features/payments/hooks", () => ({
  usePaymentList: () => ({ data: { pages: [{ items: mocks.payments, nextCursor: undefined }] }, hasNextPage: false, fetchNextPage: vi.fn(), isLoading: false, isError: false }),
}));
vi.mock("@/features/calls/components/client-calls-log", () => ({ ClientCallsLog: () => <div data-testid="calls-log" /> }));
vi.mock("@/features/messaging/components/party-chat", () => ({ PartyChat: () => <div data-testid="party-chat" /> }));
vi.mock("@/features/messaging/components/text-button", () => ({ TextButton: () => <button type="button">Text</button> }));
vi.mock("@/features/telephony/components/call-client-button", () => ({ CallClientButton: ({ to }: { to: string }) => <button type="button" aria-label={`Call ${to}`} /> }));
vi.mock("@/features/portal/components/portal-link-card", () => ({ PortalLinkCard: () => <div data-testid="portal-card" /> }));
vi.mock("@/features/billing/components/client-documents", () => ({
  ClientEstimatesList: () => <div data-testid="estimates-list" />,
  ClientInvoicesList: () => <div data-testid="invoices-list" />,
}));
vi.mock("./contact-form", () => ({ ContactForm: () => <div data-testid="contact-form" /> }));

import { ContactDetailPage } from "./contact-detail-page";

const addr = (street: string, city: string, state: string, zip: string) => ({ street, city, state, zip });

const CONTACT = {
  id: "c1",
  firstName: "CBRE",
  lastName: "Facilities Management",
  phones: ["+18557836342", "+14753296229"],
  phoneExtensions: {},
  emails: ["pendingvendorinvoice@cbre.com"],
  addresses: [
    addr("241 E Farm to Market Rd 1382", "Cedar Hill", "TX", "75104"),
    addr("300 Convent St", "San Antonio", "TX", "78205"),
    addr("300 Convent St", "San Antonio", "TX", "78205"),
    addr("18840 I-35 ste 100", "Kyle", "TX", "78640"),
  ],
  billingAddress: addr("200 E Campus View Blvd ste 120", "Columbus", "OH", "43235"),
  companyId: "co1",
  type: "company_representative",
  source: "manual",
  notes: "Net 45 client. Tax exempt.",
  taxExempt: true,
  tagIds: ["t-platinum", "t-taxfree"],
  lastJobAt: "2026-10-09",
  status: "active",
  createdBy: "u1",
  createdAt: "2025-04-14T16:10:04.000Z",
  updatedAt: "2026-08-07T20:59:39.000Z",
};

const deal = (id: string, number: string, address: ReturnType<typeof addr>, extra: Partial<Deal> = {}): Deal =>
  ({
    id,
    dealNumber: number,
    contactId: "c1",
    address,
    jobTypeId: "jt1",
    superStatus: "done",
    scheduledDate: "2026-10-09",
    scheduledTimeSlot: "11:00-12:00",
    totals: { total: 100, subtotal: 100, discount: 0, tax: 0, cost: 0 },
    ...extra,
  }) as Deal;

describe("ContactDetailPage — the client card, laid out as Workiz's", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.perms.allowed = new Set(["*"]);
    mocks.deals.pages = [
      {
        data: [
          deal("d1", "3Y1CNX", addr("300 Convent St", "San Antonio", "TX", "78205"), { clientName: { firstName: "GARDAWORLD:", lastName: "GWFS-0135" } }),
          deal("d2", "5EZ2W2", addr("300 Convent St", "San Antonio", "TX", "78205"), { superStatus: "pending" as Deal["superStatus"], totals: undefined }),
          deal("d3", "237KUO", addr("5310 Burnet Rd", "Austin", "TX", "78756"), { scheduledDate: undefined, scheduledTimeSlot: undefined }),
        ],
      },
    ];
    mocks.deals.hasNextPage = false;
    mocks.payments = [];
    server.use(
      http.get("*/crm/contacts/c1", () => HttpResponse.json({ success: true, data: CONTACT })),
      http.get("*/deals/client-tags", () =>
        HttpResponse.json({
          success: true,
          data: [
            { id: "t-platinum", name: "PLATINUM", color: "blue", priority: 0, active: true },
            { id: "t-taxfree", name: "tax free", color: "green", priority: 0, active: true },
          ],
        }),
      ),
      http.get("*/crm/companies/co1", () =>
        HttpResponse.json({ success: true, data: { id: "co1", title: "CBRE Facilities Management", clientType: "commercial", phones: [], emails: [] } }),
      ),
    );
  });

  const renderPage = async () => {
    const r = renderWithClient(<ContactDetailPage contactId="c1" />);
    await screen.findByRole("heading", { name: "CBRE Facilities Management" });
    return r;
  };

  it("the left panel shows the contact details, ONE service address and ONE billing address — not every job address", async () => {
    await renderPage();
    const panel = screen.getByRole("complementary", { name: "Client" });

    expect(await within(panel).findByRole("link", { name: "CBRE Facilities Management" })).toHaveAttribute("href", "/companies/co1");
    expect(within(panel).getByText("(855) 783-6342")).toBeInTheDocument();
    expect(within(panel).getByText("pendingvendorinvoice@cbre.com")).toBeInTheDocument();
    expect(within(panel).getByText("Tax exempt")).toBeInTheDocument();
    // Workiz's tags, as chips with a way off and a way to add.
    expect(await within(panel).findByText("PLATINUM")).toBeInTheDocument();
    expect(within(panel).getByText("tax free")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Add tag" })).toBeInTheDocument();

    expect(within(panel).getByText("Service address").parentElement).toHaveTextContent("241 E Farm to Market Rd 1382, Cedar Hill, TX 75104");
    expect(within(panel).getByText("Billing address").parentElement).toHaveTextContent("200 E Campus View Blvd ste 120, Columbus, OH 43235");
    expect(within(panel).queryByText(/300 Convent St/)).toBeNull();
    expect(within(panel).queryByText(/18840 I-35/)).toBeNull();
  });

  it("shows Workiz's four cards over the client's invoices and estimates, money only with financials.view", async () => {
    await renderPage();
    expect(screen.getByText("Past due").parentElement).toHaveTextContent("$100.00");
    expect(screen.getByText("Due").parentElement).toHaveTextContent("$150.00");
    expect(screen.getByText("Total revenue").parentElement).toHaveTextContent("$350.00");
    expect(screen.getByText("Estimates", { selector: "[data-slot=kpi-label]" }).parentElement).toHaveTextContent("3");
  });

  it("hides the money cards from a role without financials.view", async () => {
    mocks.perms.allowed = new Set(["contacts", "deals", "estimates", "invoices", "calls", "messages"]);
    await renderPage();
    expect(screen.queryByText("Past due")).toBeNull();
    expect(screen.queryByText("Total revenue")).toBeNull();
    expect(screen.getByText("Estimates", { selector: "[data-slot=kpi-label]" }).parentElement).toHaveTextContent("3");
  });

  it("has Workiz's tabs, Jobs first and open, with the job table's columns", async () => {
    await renderPage();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Jobs 3", "Estimates", "Invoices", "Payments", "Addresses 5", "Calls", "Messages"]);
    expect(screen.getByRole("tab", { name: /^Jobs/ })).toHaveAttribute("aria-selected", "true");

    const table = screen.getByRole("table", { name: "Jobs" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Id", "Name", "Address", "City", "State", "Zipcode", "Job Date", "Job Type", "Status", "Total", "Amount Due",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByRole("link", { name: "3Y1CNX" })).toHaveAttribute("href", "/deals/d1");
    expect(rows[0]).toHaveTextContent("GARDAWORLD: GWFS-0135");
    expect(rows[0]).toHaveTextContent("300 Convent St");
    expect(rows[0]).toHaveTextContent("San Antonio");
    expect(rows[0]).toHaveTextContent("Fri Oct 09, 2026 11:00 am");
    expect(rows[0]).toHaveTextContent("Lock Repair");
    expect(rows[0]).toHaveTextContent("Done");
    expect(rows[0]).toHaveTextContent("$100.00");
    expect(rows[1]).toHaveTextContent("$50.00"); // amount due from the invoice
    expect(rows[2]).toHaveTextContent("Unscheduled");
  });

  it("the Addresses tab lists each distinct address once, with its job count and total", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("tab", { name: /^Addresses/ }));

    const table = screen.getByRole("table", { name: "Addresses" });
    const rows = within(table).getAllByRole("row").slice(1);
    // service, Convent (deduped), Kyle, billing, plus the Austin job address
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("241 E Farm to Market Rd 1382");
    expect(rows[0]).toHaveTextContent("Service");
    expect(rows[1]).toHaveTextContent("300 Convent St");
    expect(within(rows[1]).getByText("2", { selector: "td" })).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent("Billing");

    await userEvent.type(screen.getByRole("searchbox", { name: "Search addresses" }), "austin");
    expect(within(screen.getByRole("table", { name: "Addresses" })).getAllByRole("row").slice(1)).toHaveLength(1);
  });

  it("asks for the rest of the jobs when the Addresses tab opens with more pages", async () => {
    mocks.deals.hasNextPage = true;
    await renderPage();
    await userEvent.click(screen.getByRole("tab", { name: /^Addresses/ }));
    await waitFor(() => expect(mocks.deals.fetchNextPage).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: /^Jobs/ })).toHaveTextContent("3+");
  });

  it("Create new offers a job for this client and a text", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Create new" }));
    expect(await screen.findByRole("menuitem", { name: "Job" })).toHaveAttribute("href", "/deals/new?contactId=c1");
    expect(screen.getByRole("menuitem", { name: "Message" })).toBeInTheDocument();
  });

  it("the card's menu edits or deletes the client, by permission", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Client actions" }));
    expect(await screen.findByRole("menuitem", { name: "Edit client" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete client" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit client" }));
    expect(await screen.findByTestId("contact-form")).toBeInTheDocument();
  });

  it("Notes open in the right rail", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(await screen.findByText("Net 45 client. Tax exempt.")).toBeInTheDocument();
  });

  it("the Payments tab lists the client's payments", async () => {
    mocks.payments = [
      { id: "p1", dealId: "d1", amount: 481, method: "cash", status: "settled", takenAt: "2026-09-30T03:10:33.000Z", tipAmount: 0 } as Payment,
    ];
    await renderPage();
    await userEvent.click(screen.getByRole("tab", { name: "Payments" }));
    const table = screen.getByRole("table", { name: "Payments" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(1);
    expect(table).toHaveTextContent("$481.00");
    expect(table).toHaveTextContent("Cash");
    expect(within(table).getByRole("link", { name: "3Y1CNX" })).toHaveAttribute("href", "/deals/d1");
  });
});
