import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientType, ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Company, Contact } from "@bitcrm/types";
import { installFakeServer, renderWithClient } from "@/test/page-load";

/**
 * The company page drawn as Workiz's client page (BitCRM-only page; the
 * closest Workiz pattern is `/root/client/<id>/`, our `/contacts/[id]`): the
 * 300px left column (name, ⋮ Edit / Delete, type, CONTACT, PLATINUM, the
 * Addresses fold), the totals of its people's documents, "Create new", the
 * small tabs — Contacts (the roster), Estimates, Invoices, Compliance — and
 * the rail (Notes, Messages). Every button follows its permission.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/companies/co1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const grants = new Set<string>();
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: (r: string, a = "view") => grants.has(`${r}.${a}`), isLoading: false, me: { id: "u1" } }),
}));
vi.mock("@/features/messaging/components/party-chat", () => ({
  PartyChat: ({ partyKind, partyId }: { partyKind: string; partyId: string }) => <div data-testid="party-chat">{`${partyKind}:${partyId}`}</div>,
}));
vi.mock("@/features/telephony/components/call-client-button", () => ({
  CallClientButton: ({ to, kind }: { to: string; kind?: string }) => <button type="button" aria-label={`Call ${to} (${kind})`} />,
}));
vi.mock("./contact-form", () => ({ ContactForm: ({ defaultCompanyId }: { defaultCompanyId?: string }) => <div data-testid="contact-form">{defaultCompanyId}</div> }));

const base: Company = {
  id: "co1",
  title: "Acme Storage",
  phones: ["+14045550100", "+14045550199"],
  emails: ["office@acme.example"],
  address: "1 Main St, Marietta, GA",
  website: "acme.example",
  notes: "Gate code 1234",
  clientType: ClientType.COMMERCIAL,
  isPlatinum: true,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};
let company: Company = base;

const person = (id: string, firstName: string, lastName: string): Contact => ({
  id,
  firstName,
  lastName,
  phones: [],
  emails: [],
  addresses: [],
  companyId: "co1",
  type: ContactType.COMPANY_REPRESENTATIVE,
  source: ContactSource.MANUAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
});

const { CompanyDetailPage } = await import("./company-detail-page");

const ALL = [
  "companies.view",
  "companies.edit",
  "companies.delete",
  "contacts.view",
  "contacts.create",
  "estimates.view",
  "invoices.view",
  "financials.view",
  "messages.view",
  "messages.send",
];

beforeEach(() => {
  grants.clear();
  ALL.forEach((g) => grants.add(g));
  company = base;
  push.mockClear();
  installFakeServer([
    { match: /\/crm\/companies\/co1$/, reply: () => company },
    {
      match: /\/crm\/companies\/co1\/contacts$/,
      raw: true,
      reply: () => ({ success: true, data: [person("c1", "Jane", "Smith"), person("c2", "Bob", "Jones")], pagination: { count: 2 } }),
    },
    { match: /\/deals\/job-sources$/, reply: () => [] },
    {
      match: /\/billing\/invoices$/,
      reply: (url) =>
        url.searchParams.get("contactId") === "c1"
          ? {
              items: [
                { id: "i1", contactId: "c1", number: "1001", dueDate: "2026-01-01", status: "sent", createdAt: "2026-09-01", totals: { total: 100, balanceDue: 40, amountPaid: 60 } },
              ],
            }
          : { items: [] },
    },
    {
      match: /\/billing\/estimates$/,
      reply: (url) => (url.searchParams.get("contactId") === "c2" ? { items: [{ id: "e1", contactId: "c2", number: "E-7", name: "Rekey", status: "sent", createdAt: "2026-09-02" }] } : { items: [] }),
    },
    { match: /\/crm\/companies\/co1\/documents$/, reply: () => [] },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openPage() {
  renderWithClient(<CompanyDetailPage companyId="co1" />);
  return screen.findByRole("heading", { name: "Acme Storage" }, { timeout: 3000 });
}

describe("CompanyDetailPage — the left column", () => {
  it("prints the name, its type under it, the numbers as Workiz writes them, the email, the website and PLATINUM", async () => {
    await openPage();
    const left = screen.getByRole("complementary", { name: "Company" });
    expect(within(left).getByText("Commercial")).toBeInTheDocument();
    expect(within(left).getByText("(404) 555 - 0100")).toBeInTheDocument();
    expect(within(left).getByText("(404) 555 - 0199")).toBeInTheDocument();
    expect(within(left).getByText("office@acme.example")).toBeInTheDocument();
    expect(within(left).getByRole("link", { name: "acme.example" })).toHaveAttribute("href", "https://acme.example");
    expect(within(left).getByText("Platinum")).toBeInTheDocument();
    // A call button by each number (the company's call history), the message button by the primary only.
    expect(within(left).getByRole("button", { name: "Call +14045550100 (company)" })).toBeInTheDocument();
    expect(within(left).getAllByRole("button", { name: "Message company" })).toHaveLength(1);
  });

  it("the Addresses fold holds the company's address", async () => {
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: "Addresses" }));
    expect(screen.getByText("1 Main St, Marietta, GA")).toBeInTheDocument();
  });

  it("⋮ opens Edit company info / Delete company; Edit opens the form in Workiz's modal", async () => {
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: "Edit company" }));
    expect(await screen.findByRole("menuitem", { name: "Delete company" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit company info" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit company info" });
    expect(within(dialog).getByDisplayValue("Acme Storage")).toBeInTheDocument();
  });

  it("has no ⋮ for someone who may neither edit nor delete companies", async () => {
    grants.delete("companies.edit");
    grants.delete("companies.delete");
    await openPage();
    expect(screen.queryByRole("button", { name: "Edit company" })).toBeNull();
  });
});

describe("CompanyDetailPage — totals, Create new and tabs", () => {
  it("adds up its people's invoices and estimates: PAST DUE, DUE, TOTAL REVENUE, ESTIMATES", async () => {
    await openPage();
    const totals = screen.getByRole("group", { name: "Company totals" });
    expect(within(totals).getByText("Past due").nextElementSibling).toHaveTextContent("$40.00");
    expect(within(totals).getByText("Due").nextElementSibling).toHaveTextContent("$40.00");
    expect(within(totals).getByText("Total revenue").nextElementSibling).toHaveTextContent("$60.00");
    expect(within(totals).getByText("Estimates").nextElementSibling).toHaveTextContent("1");
  });

  it("keeps the money from a role without financials.view", async () => {
    grants.delete("financials.view");
    await openPage();
    const totals = screen.getByRole("group", { name: "Company totals" });
    expect(within(totals).queryByText("Past due")).toBeNull();
    expect(within(totals).getByText("Estimates")).toBeInTheDocument();
  });

  it("opens on the Contacts tab — the roster — and the row opens the person", async () => {
    await openPage();
    expect(screen.getByRole("tab", { name: "Contacts 2" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByText("Jane Smith"));
    expect(push).toHaveBeenCalledWith("/contacts/c1");
  });

  it("Estimates and Invoices list everyone's documents; Compliance holds the terms", async () => {
    await openPage();
    await userEvent.click(screen.getByRole("tab", { name: "Estimates 1" }));
    expect(screen.getByText("E-7")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Invoices 1" }));
    expect(screen.getByText("1001")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Compliance" }));
    expect(await screen.findByText("Payment terms")).toBeInTheDocument();
  });

  it("shows no Estimates / Invoices tab to a role that may not view them", async () => {
    grants.delete("estimates.view");
    grants.delete("invoices.view");
    await openPage();
    expect(screen.queryByRole("tab", { name: /^Estimates/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /^Invoices/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "Compliance" })).toBeInTheDocument();
  });

  it("Create new → Contact links a new person to the company; + Add contact on the strip does too", async () => {
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: "Create new" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Contact" }));
    const dialog = await screen.findByRole("dialog", { name: "New contact · Acme Storage" });
    expect(within(dialog).getByTestId("contact-form")).toHaveTextContent("co1");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Add contact" }));
    expect(await screen.findByRole("dialog", { name: "New contact · Acme Storage" })).toBeInTheDocument();
  });

  it("Create new → Message opens the company's messages in the rail", async () => {
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: "Create new" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Message" }));
    expect(await screen.findByTestId("party-chat")).toHaveTextContent("company:co1");
  });

  it("no Create new and no Add contact for someone who may neither add people nor send texts", async () => {
    grants.delete("contacts.create");
    grants.delete("messages.send");
    await openPage();
    expect(screen.queryByRole("button", { name: "Create new" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add contact" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Message company" })).toBeNull();
  });
});

describe("CompanyDetailPage — the rail", () => {
  it("Notes carries the company's notes, with a count", async () => {
    await openPage();
    const rail = screen.getByRole("complementary", { name: "Company rail" });
    await userEvent.click(within(rail).getByRole("button", { name: "Notes (1)" }));
    const panel = screen.getByRole("complementary", { name: "Notes" });
    expect(within(panel).getByText("Gate code 1234")).toBeInTheDocument();
    // The notes are a field of the company: editing them is Edit company info.
    await userEvent.click(within(panel).getByRole("button", { name: "Edit note" }));
    expect(await screen.findByRole("dialog", { name: "Edit company info" })).toBeInTheDocument();
  });

  it("Notes without notes says so", async () => {
    company = { ...base, notes: undefined };
    await openPage();
    const rail = screen.getByRole("complementary", { name: "Company rail" });
    await userEvent.click(within(rail).getByRole("button", { name: "Notes" }));
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
  });

  it("Messages is the company's thread; there is none for a role that may not read messages", async () => {
    await openPage();
    const rail = screen.getByRole("complementary", { name: "Company rail" });
    await userEvent.click(within(rail).getByRole("button", { name: "Messages" }));
    expect(screen.getByTestId("party-chat")).toHaveTextContent("company:co1");
    cleanup();

    grants.delete("messages.view");
    await openPage();
    expect(within(screen.getByRole("complementary", { name: "Company rail" })).queryByRole("button", { name: "Messages" })).toBeNull();
  });
});
