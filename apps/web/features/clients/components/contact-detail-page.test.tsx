import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { Deal, Payment } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  dealsPageArgs: [] as unknown[],
  createEstimate: vi.fn(),
  createInvoice: vi.fn(),
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
  useDealsPage: (params: unknown) => ({
    ...(mocks.dealsPageArgs.push(params), {}),
    data: { pages: mocks.deals.pages },
    hasNextPage: mocks.deals.hasNextPage,
    fetchNextPage: mocks.deals.fetchNextPage,
    isFetchingNextPage: mocks.deals.isFetchingNextPage,
    isLoading: false,
    isError: false,
  }),
  useUserMap: () => ({ map: new Map(), users: [], isLoading: false }),
  useContactTimeline: () => ({
    data: {
      pages: [
        {
          data: [
            { id: "h1", dealId: "d1", dealNumber: "3Y1CNX", eventType: "note_added", actorId: "u1", actorName: "Piper", timestamp: "2026-09-30T19:53:00.000Z", details: {}, note: "scheduled 10-12pm" },
          ],
          pagination: { count: 1 },
        },
      ],
    },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));
// The history rail resolves the ids its rows carry through these catalogs.
vi.mock("@/features/job-statuses/hooks", () => ({ useJobStatuses: () => ({ data: [] }) }));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [] }) }));
vi.mock("@/features/external-companies/hooks", () => ({ useExternalCompanies: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));
vi.mock("@/features/invoices/hooks", () => ({
  useInvoicesForContacts: () => ({
    data: [
      { id: "i1", dealId: "d1", number: "D1", dueDate: "2026-09-01", status: "sent", totals: { total: 100, balanceDue: 100, amountPaid: 0 } },
      { id: "i2", dealId: "d2", number: "D2", dueDate: "2026-12-01", status: "sent", totals: { total: 250, balanceDue: 50, amountPaid: 200 } },
    ],
    isLoading: false,
    isError: false,
  }),
  useCreateClientInvoice: () => ({ mutate: mocks.createInvoice, isPending: false }),
}));
vi.mock("@/features/estimates/hooks", () => ({
  useEstimatesForContacts: () => ({ data: [{ id: "e1" }, { id: "e2" }, { id: "e3" }], isLoading: false, isError: false }),
  useCreateClientEstimate: () => ({ mutate: mocks.createEstimate, isPending: false }),
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
vi.mock("@/features/payments/components/record-payment-dialog", () => ({
  RecordPaymentDialog: ({ invoiceId, balanceDue, open, onOpenChange }: { invoiceId: string; balanceDue: number; open: boolean; onOpenChange: (o: boolean) => void }) =>
    open ? (
      <div data-testid="record-payment" data-invoice={invoiceId} data-balance={balanceDue}>
        <button type="button" onClick={() => onOpenChange(false)}>Done</button>
      </div>
    ) : null,
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { env: { ...actual.env, googleMapsApiKey: "test-key" } };
});
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Map: ({ children, center, defaultCenter }: { children?: React.ReactNode; center?: { lat: number; lng: number }; defaultCenter?: { lat: number; lng: number } }) => (
    <div data-testid="map" data-center={JSON.stringify(center ?? defaultCenter)}>{children}</div>
  ),
  AdvancedMarker: ({ position }: { position?: { lat: number; lng: number } }) => <div data-testid="marker" data-position={JSON.stringify(position)} />,
  Marker: ({ position }: { position?: { lat: number; lng: number } }) => <div data-testid="marker" data-position={JSON.stringify(position)} />,
}));
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <input aria-label="Address" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

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
  billingAddress: { ...addr("200 E Campus View Blvd ste 120", "Columbus", "OH", "43235"), lat: 40.0955, lng: -82.9931 },
  companyId: "co1",
  type: "company_representative",
  source: "manual",
  notes: "Net 45 client. Tax exempt.",
  taxExempt: true,
  tagIds: ["t-platinum", "t-taxfree"],
  sourceId: "src-tx-platinum",
  paymentTerms: "custom",
  customTermsDays: 60,
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
      http.get("*/deals/job-sources", () =>
        HttpResponse.json({ success: true, data: [{ id: "src-tx-platinum", name: "SURE TX PLATINUM", priority: 1, active: true }] }),
      ),
      http.get("*/crm/companies/co1", () =>
        HttpResponse.json({ success: true, data: { id: "co1", title: "CBRE Facilities Management", clientType: "commercial", phones: [], emails: [] } }),
      ),
      http.get("*/crm/contacts/c1/notes", () =>
        HttpResponse.json({
          success: true,
          data: [
            { id: "n1", contactId: "c1", note: "Gate code 4421", actorId: "u1", actorName: "Betty", pinned: false, createdAt: "2025-07-24T18:19:00", updatedAt: "2025-07-24T18:19:00" },
            { id: "n2", contactId: "c1", note: "Call before arriving", actorId: "u1", actorName: "Betty", pinned: true, createdAt: "2025-03-01T09:00:00", updatedAt: "2025-03-01T09:00:00" },
          ],
          pagination: { count: 2 },
          notesCount: 2,
        }),
      ),
      http.get("*/deals/attachments/by-contact/c1", () =>
        HttpResponse.json({
          success: true,
          data: [{ id: "f1", contactId: "c1", dealId: "d1", dealNumber: "3Y1CNX", fileName: "invoice.pdf", contentType: "application/pdf", size: 5678, uploadedBy: "u1", uploadedAt: "2026-08-20T10:00:00" }],
          pagination: { count: 1 },
        }),
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
    // Workiz's Ad source and payment terms, by name — not the closed "Manual" enum.
    expect(await within(panel).findByText("SURE TX PLATINUM")).toBeInTheDocument();
    expect(within(panel).queryByText("Manual")).toBeNull();
    expect(within(panel).getByText("Net-60 (custom)")).toBeInTheDocument();

    expect(within(panel).getByText("Service address").closest("[data-slot=address-card]")).toHaveTextContent("241 E Farm to Market Rd 1382, Cedar Hill, TX 75104");
    expect(within(panel).getByText("Billing address").closest("[data-slot=address-card]")).toHaveTextContent("200 E Campus View Blvd ste 120, Columbus, OH 43235");
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
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Jobs 3", "Estimates", "Invoices", "Payments", "Addresses 5", "Calls"]);
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

  it("asks the API for the client's jobs only — no schedule sort, which the API answered with the whole account", async () => {
    mocks.dealsPageArgs.length = 0;
    await renderPage();
    expect(mocks.dealsPageArgs[0]).toEqual({ contactId: "c1", limit: 50 });
  });

  it("orders the Jobs tab by job date, newest first, as Workiz does", async () => {
    mocks.deals.pages = [
      {
        data: [
          deal("d1", "OLDEST", addr("1 A St", "Dallas", "TX", "75201"), { scheduledDate: "2026-09-01" }),
          deal("d2", "NEWEST", addr("2 B St", "Dallas", "TX", "75201"), { scheduledDate: "2026-10-09" }),
          deal("d3", "UNDATED", addr("3 C St", "Dallas", "TX", "75201"), { scheduledDate: undefined, scheduledTimeSlot: undefined }),
          deal("d4", "MIDDLE", addr("4 D St", "Dallas", "TX", "75201"), { scheduledDate: "2026-10-01" }),
        ],
      },
    ];
    await renderPage();
    const rows = within(screen.getByRole("table", { name: "Jobs" })).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("link").textContent)).toEqual(["NEWEST", "MIDDLE", "OLDEST", "UNDATED"]);
  });

  it("pages the jobs like Workiz: arrows, Page X of Y, Showing a to b of N results, ten a page", async () => {
    mocks.deals.pages = [
      {
        data: Array.from({ length: 12 }, (_, i) =>
          deal(`d${i + 1}`, `JOB${String(i + 1).padStart(3, "0")}`, addr(`${i + 1} Main St`, "Dallas", "TX", "75201")),
        ),
      },
    ];
    await renderPage();

    const table = screen.getByRole("table", { name: "Jobs" });
    expect(within(table).getAllByRole("row").slice(1)).toHaveLength(10);
    const pager = screen.getByTestId("client-pagination");
    expect(pager).toHaveTextContent("Showing 1 to 10 of 12 results");
    expect(pager).toHaveTextContent("Page 1 of 2");
    expect(within(pager).getByRole("button", { name: "Previous page" })).toBeDisabled();

    await userEvent.click(within(pager).getByRole("button", { name: "Next page" }));
    expect(within(screen.getByRole("table", { name: "Jobs" })).getAllByRole("row").slice(1)).toHaveLength(2);
    expect(screen.getByTestId("client-pagination")).toHaveTextContent("Showing 11 to 12 of 12 results");
    expect(screen.getByTestId("client-pagination")).toHaveTextContent("Page 2 of 2");
    expect(within(screen.getByTestId("client-pagination")).getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: /^Jobs/ })).toHaveTextContent("12");
  });

  it("asks for every page of the client's jobs as the card opens, so the count and the pages are exact", async () => {
    mocks.deals.hasNextPage = true;
    await renderPage();
    await waitFor(() => expect(mocks.deals.fetchNextPage).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: /^Jobs/ })).toHaveTextContent("3+");
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
    expect(screen.getByTestId("client-pagination")).toHaveTextContent("Showing 1 to 1 of 1 results");
    expect(screen.getByTestId("client-pagination")).toHaveTextContent("Page 1 of 1");
  });


  it("Create new has Workiz's items that BitCRM can honour: Job, Estimate, Invoice, Message, Address, Pay Invoices", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Create new" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual(["Job", "Estimate", "Invoice", "Message", "Address", "Pay Invoices"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Message" }));
    expect(await screen.findByTestId("party-chat")).toBeInTheDocument();
  });

  // Workiz: Create new → Estimate makes the client's estimate (no job) at once and opens it.
  it("Create new → Estimate creates a client estimate (no job) and opens its page", async () => {
    mocks.createEstimate.mockImplementation((_contactId: string, opts?: { onSuccess?: (e: { id: string; number: string }) => void }) =>
      opts?.onSuccess?.({ id: "e-new", number: "1141" }),
    );
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Create new" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Estimate" }));
    expect(mocks.createEstimate).toHaveBeenCalledWith("c1", expect.anything());
    expect(mocks.push).toHaveBeenCalledWith("/estimates/e-new");
  });

  it("Create new → Invoice creates a client invoice (no job) and opens its page", async () => {
    mocks.createInvoice.mockImplementation((_contactId: string, opts?: { onSuccess?: (i: { id: string; number: string }) => void }) =>
      opts?.onSuccess?.({ id: "inv-new", number: "1001" }),
    );
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Create new" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Invoice" }));
    expect(mocks.createInvoice).toHaveBeenCalledWith("c1", expect.anything());
    expect(mocks.push).toHaveBeenCalledWith("/invoices/inv-new");
  });

  it("Create new → Job asks which of the client's addresses the job is at, as Workiz does", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Create new" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Job" }));

    const dialog = await screen.findByRole("dialog", { name: "Select a service location" });
    // One row per distinct address (the service address first), each with Use this address.
    const uses = within(dialog).getAllByRole("link", { name: "Use this address" });
    expect(uses).toHaveLength(3);
    expect(uses[0]).toHaveAttribute("href", "/deals/new?contactId=c1&address=0");
    expect(within(dialog).getByText("241 E Farm to Market Rd 1382, Cedar Hill, TX 75104")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Create new location" })).toHaveAttribute("href", "/deals/new?contactId=c1&address=new");

    await userEvent.type(within(dialog).getByRole("searchbox", { name: "Search property" }), "kyle");
    expect(within(dialog).getAllByRole("link", { name: "Use this address" })).toHaveLength(1);
  });

  it("Create new → Address opens Workiz's side panel and saves the address onto the client", async () => {
    const puts: unknown[] = [];
    server.use(
      http.put("*/crm/contacts/c1", async ({ request }) => {
        const body = (await request.json()) as { addresses: unknown[] };
        puts.push(body);
        return HttpResponse.json({ success: true, data: { ...CONTACT, addresses: body.addresses } });
      }),
    );
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Create new" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Address" }));

    const panel = await screen.findByRole("dialog", { name: "Address" });
    await userEvent.type(within(panel).getByRole("textbox", { name: "Address" }), "5 Oak Ave");
    await userEvent.type(within(panel).getByRole("textbox", { name: "Unit" }), "2B");
    await userEvent.type(within(panel).getByRole("textbox", { name: "City" }), "Austin");
    await userEvent.type(within(panel).getByRole("textbox", { name: "State" }), "TX");
    await userEvent.type(within(panel).getByRole("textbox", { name: "Zip" }), "78701");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    const sent = (puts[0] as { addresses: { street: string }[] }).addresses;
    expect(sent).toHaveLength(CONTACT.addresses.length + 1);
    expect(sent.at(-1)).toMatchObject({ street: "5 Oak Ave", unit: "2B", city: "Austin", state: "TX", zip: "78701" });
  });

  it("the pencil on Billing address opens the Address panel on it, with the client's properties to pick from", async () => {
    const puts: unknown[] = [];
    server.use(
      http.put("*/crm/contacts/c1", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        puts.push(body);
        return HttpResponse.json({ success: true, data: { ...CONTACT, ...body } });
      }),
    );
    await renderPage();
    const panel = screen.getByRole("complementary", { name: "Client" });
    await userEvent.click(within(panel).getByRole("button", { name: "Edit billing address" }));

    const sheet = await screen.findByRole("dialog", { name: "Address" });
    expect(within(sheet).getByRole("combobox", { name: "Client properties" })).toHaveTextContent("200 E Campus View Blvd ste 120");
    expect(within(sheet).getByRole("textbox", { name: "City" })).toHaveValue("Columbus");
    // Workiz's map above the fields, pinned on the address, with Maps and Get directions links.
    expect(within(sheet).getByTestId("marker")).toHaveAttribute("data-position", JSON.stringify({ lat: 40.0955, lng: -82.9931 }));
    expect(within(sheet).getByRole("link", { name: "Maps" })).toHaveAttribute("href", expect.stringContaining("google.com/maps/search/?api=1&query=200%20E%20Campus%20View%20Blvd%20ste%20120"));
    expect(within(sheet).getByRole("link", { name: "Get directions" })).toHaveAttribute("href", expect.stringContaining("google.com/maps/dir/?api=1&destination="));

    await userEvent.clear(within(sheet).getByRole("textbox", { name: "Unit" }));
    await userEvent.type(within(sheet).getByRole("textbox", { name: "Unit" }), "ste 130");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ billingAddress: { street: "200 E Campus View Blvd ste 120", unit: "ste 130", city: "Columbus", state: "OH", zip: "43235", lat: 40.0955, lng: -82.9931 } });
  });

  it("the pencil on Service address lets another of the client's properties become the service address", async () => {
    const puts: unknown[] = [];
    server.use(
      http.put("*/crm/contacts/c1", async ({ request }) => {
        const body = (await request.json()) as { addresses: { street: string }[] };
        puts.push(body);
        return HttpResponse.json({ success: true, data: { ...CONTACT, addresses: body.addresses } });
      }),
    );
    await renderPage();
    const panel = screen.getByRole("complementary", { name: "Client" });
    await userEvent.click(within(panel).getByRole("button", { name: "Edit service address" }));

    const sheet = await screen.findByRole("dialog", { name: "Address" });
    expect(within(sheet).getByRole("combobox", { name: "Client properties" })).toHaveTextContent("241 E Farm to Market Rd 1382");
    await userEvent.click(within(sheet).getByRole("combobox", { name: "Client properties" }));
    await userEvent.click(await screen.findByRole("option", { name: /18840 I-35 ste 100/ }));
    expect(within(sheet).getByRole("textbox", { name: "City" })).toHaveValue("Kyle");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(puts).toHaveLength(1));
    const sent = (puts[0] as { addresses: { street: string }[] }).addresses.map((a) => a.street);
    // The chosen property leads; the rest keep their order; nothing is lost or doubled.
    expect(sent).toEqual(["18840 I-35 ste 100", "241 E Farm to Market Rd 1382", "300 Convent St", "300 Convent St"]);
  });

  it("Create new → Pay Invoices lists the unpaid invoices with a total, and records them one after another", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Create new" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Pay Invoices" }));

    const dialog = await screen.findByRole("dialog", { name: "Pay 2 invoices" });
    expect(within(dialog).getByRole("checkbox", { name: /Invoice #D1/ })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: /Invoice #D2/ })).toBeChecked();
    expect(dialog).toHaveTextContent("Total:$150.00");

    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Invoice #D2/ }));
    expect(dialog).toHaveTextContent("Total:$100.00");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Invoice #D2/ }));

    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    const first = await screen.findByTestId("record-payment");
    expect(first).toHaveAttribute("data-invoice", "i1");
    expect(first).toHaveAttribute("data-balance", "100");
    await userEvent.click(within(first).getByRole("button", { name: "Done" }));
    expect(await screen.findByTestId("record-payment")).toHaveAttribute("data-invoice", "i2");
  });

  it("a message button beside the phone opens the client's chat in a side panel, as on the job; no Messages tab", async () => {
    await renderPage();
    expect(screen.queryByRole("tab", { name: "Messages" })).toBeNull();
    expect(screen.queryByTestId("party-chat")).toBeNull();

    const panel = screen.getByRole("complementary", { name: "Client" });
    // One message button, beside the primary number only; every number keeps its call button.
    expect(within(panel).getAllByRole("button", { name: "Message client" })).toHaveLength(1);
    expect(within(panel).getAllByRole("button", { name: /^Call / })).toHaveLength(2);
    await userEvent.click(within(panel).getByRole("button", { name: "Message client" }));
    expect(await screen.findByTestId("party-chat")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("CBRE Facilities Management");
  });

  it("the card's menu opens Workiz's Edit client info popup, or deletes the client, by permission", async () => {
    await renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Edit client" }));
    expect(await screen.findByRole("menuitem", { name: "Edit client info" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete client" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit client info" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit client info" });
    expect(within(dialog).getByTestId("contact-form")).toBeInTheDocument();
    // The card stays underneath: the popup is over it, not instead of it.
    expect(screen.getByRole("complementary", { name: "Client", hidden: true })).toBeInTheDocument();
  });

  describe("the right rail, as Workiz's: Notes, History, Files", () => {
    it("stacks the three buttons, Notes with a badge counting the CRM notes plus the legacy description", async () => {
      await renderPage();
      const rail = screen.getByRole("complementary", { name: "Client rail" });
      expect(within(rail).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Notes", "History", "Files"]);
      expect(await within(within(rail).getByRole("button", { name: "Notes" })).findByText("3")).toBeInTheDocument();
    });

    it("Notes opens the notes panel: the legacy description first, then the CRM notes, pinned on top", async () => {
      await renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Notes" }));
      const dialog = await screen.findByRole("dialog", { name: "Notes" });
      await within(dialog).findByText("Gate code 4421");
      const cards = within(dialog).getAllByTestId("note-card");
      expect(cards[0]).toHaveTextContent("Net 45 client. Tax exempt.");
      expect(cards[1]).toHaveTextContent("Call before arriving");
      expect(cards[2]).toHaveTextContent("Gate code 4421");
      expect(within(dialog).getByRole("button", { name: "Add note" })).toBeInTheDocument();
    });

    it("History opens the client's feed across jobs, each row linking its job", async () => {
      await renderPage();
      await userEvent.click(screen.getByRole("button", { name: "History" }));
      const dialog = await screen.findByRole("dialog", { name: "History" });
      expect(await within(dialog).findByText(/scheduled 10-12pm/)).toBeInTheDocument();
      expect(within(dialog).getByRole("link", { name: "3Y1CNX" })).toHaveAttribute("href", "/deals/d1");
      expect(within(dialog).getByRole("combobox", { name: "Filters" })).toBeInTheDocument();
    });

    it("Files opens the client's files across jobs, with Upload file for contacts.edit", async () => {
      await renderPage();
      await userEvent.click(screen.getByRole("button", { name: "Files" }));
      const dialog = await screen.findByRole("dialog", { name: "Files" });
      expect(await within(dialog).findByText("invoice.pdf")).toBeInTheDocument();
      expect(within(dialog).getByRole("link", { name: "3Y1CNX" })).toHaveAttribute("href", "/deals/d1");
      expect(within(dialog).getByRole("button", { name: "Upload file" })).toBeInTheDocument();
    });
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
