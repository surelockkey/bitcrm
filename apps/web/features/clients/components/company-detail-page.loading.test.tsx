import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { ClientType, ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Company, Contact } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeServer,
} from "@/test/page-load";

/**
 * The company page appears once, whole.
 *
 * It went up with the company and then grew: "Contacts · 0" turned into the
 * real number, and the Text / Edit / Delete buttons and the Estimates /
 * Invoices / Messages tabs came when the permissions did — squeezing the
 * badges in the header across. Opening the Contacts tab then showed the
 * people's ad sources as raw ids, and a moment later as names.
 *
 * Drawn now as Workiz's client page, the page also carries the totals of its
 * people's invoices and estimates and their counts on the tabs: those are
 * asked for with the page and are in its first frame too.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
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

const company: Company = {
  id: "co1",
  title: "Acme Storage",
  phones: ["+14045550100"],
  emails: ["office@example.com"],
  address: "1 Main St, Marietta, GA",
  notes: "Gate code 1234",
  clientType: ClientType.COMMERCIAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

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
  sourceId: "src-1",
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
});

let server: FakeServer;
let client: QueryClient;

const { CompanyDetailPage } = await import("./company-detail-page");

const pageUp = () => !!screen.queryByRole("heading", { name: "Acme Storage" });
const tab = (name: RegExp) => screen.queryByRole("tab", { name });

function renderPage() {
  ({ client } = renderWithClient(<CompanyDetailPage companyId="co1" />));
}

beforeEach(() => {
  server = installFakeServer([
    // The order the browser sees: the company, its people, then the permissions.
    { match: /\/crm\/companies\/co1$/, reply: () => company },
    {
      match: /\/crm\/companies\/co1\/contacts$/,
      raw: true,
      reply: () => ({ success: true, data: [person("c1", "Jane", "Smith"), person("c2", "Bob", "Jones")], pagination: { count: 2 } }),
      delayMs: 60,
    },
    { match: /\/users\/me$/, reply: () => ({ id: "u1", firstName: "Dee", lastName: "Spatch", email: "dee@example.com", roleId: "role-super-admin" }), delayMs: 90 },
    { match: /\/deals\/job-sources$/, reply: () => [{ id: "src-1", name: "Google Ads", priority: 1, active: true }], delayMs: 120 },
    // Each person's documents, asked for once the people are known.
    {
      match: /\/billing\/invoices$/,
      reply: (url) =>
        url.searchParams.get("contactId") === "c1"
          ? { items: [{ id: "i1", contactId: "c1", number: "1001", dueDate: "2026-01-01", status: "sent", createdAt: "2026-09-01", totals: { total: 100, balanceDue: 40, amountPaid: 60 } }] }
          : { items: [] },
      delayMs: 40,
    },
    {
      match: /\/billing\/estimates$/,
      reply: (url) => (url.searchParams.get("contactId") === "c2" ? { items: [{ id: "e1", contactId: "c2", number: "E1", createdAt: "2026-09-02" }] } : { items: [] }),
      delayMs: 70,
    },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CompanyDetailPage — one load, not waves", () => {
  it("shows the company with its totals, its people, its tabs' numbers and its buttons in one frame", async () => {
    const watch = watchFirstFrame(pageUp, () => {
      const rail = screen.queryByRole("complementary", { name: "Company rail" });
      return {
        contactsTab: tab(/^Contacts/)?.textContent ?? null,
        estimatesTab: tab(/^Estimates/)?.textContent ?? null,
        invoicesTab: tab(/^Invoices/)?.textContent ?? null,
        pastDue: !!screen.queryByText("Past due"),
        due: screen.queryByText("Due")?.nextElementSibling?.textContent ?? null,
        people: !!screen.queryByText("Jane Smith") && !!screen.queryByText("Bob Jones"),
        menu: !!screen.queryByRole("button", { name: "Edit company" }),
        createNew: !!screen.queryByRole("button", { name: "Create new" }),
        notesBadge: rail ? within(rail).getByRole("button", { name: /^Notes/ }).textContent : null,
        skeletons: skeletonCount(),
      };
    });
    renderPage();
    await screen.findByRole("heading", { name: "Acme Storage" }, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({
      contactsTab: "Contacts 2",
      estimatesTab: "Estimates 1",
      invoicesTab: "Invoices 1",
      pastDue: true,
      due: "$40.00",
      people: true,
      menu: true,
      createNew: true,
      notesBadge: "Notes1",
      skeletons: 0,
    });
  });

  it("the Contacts tab is open with the people's ad sources by name, and asks for nothing more", async () => {
    const watch = watchFirstFrame(pageUp, () => ({ requestsSoFar: server.requests.length, sources: screen.queryAllByText("Google Ads").length }));
    renderPage();
    await screen.findByRole("heading", { name: "Acme Storage" }, { timeout: 3000 });
    watch.stop();
    await settle();

    expect(watch.frame()!.sources).toBe(2);
    expect(server.requests.slice(watch.frame()!.requestsSoFar)).toEqual([]);
  });

  it("asks for each thing once", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Acme Storage" }, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  it("once shown, a refetch never takes the page back to the skeleton", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Acme Storage" }, { timeout: 3000 });

    let lost = false;
    const observer = new MutationObserver(() => {
      if (!pageUp()) lost = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await client.invalidateQueries();
    await settle();
    observer.disconnect();

    expect(lost).toBe(false);
  });
});
