import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { ClientType, ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Company, Contact } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";

/**
 * The contacts list does not fill in while you watch.
 *
 * It came in five waves: the header buttons, then the rows with "Showing 0"
 * turning into "Showing 50", then the Company column going from "—" to
 * names, then "of 4641" under the table, then the Source column going from
 * raw ids to names. And a search emptied the list ("No matching contacts")
 * before the skeleton and then the matches came.
 *
 * Now the rows come with everything printed beside them — the KPI cards over
 * them (Workiz's Clients page) and the pager under them included — in one
 * frame, and a new search or page keeps the rows it has until the next set
 * is whole.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/contacts",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false, me: { id: "u1" } }),
}));

const person = (id: string, firstName: string, lastName: string, companyId: string): Contact => ({
  id,
  firstName,
  lastName,
  phones: ["+14045550100"],
  emails: [],
  addresses: [],
  companyId,
  type: ContactType.COMPANY_REPRESENTATIVE,
  source: ContactSource.MANUAL,
  sourceId: "src-1",
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
});

const company = (id: string, title: string): Company => ({
  id,
  title,
  phones: [],
  emails: [],
  clientType: ClientType.COMMERCIAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
});

const PAGE_1 = [person("c1", "Jane", "Smith", "co1"), person("c2", "Bob", "Jones", "co1"), person("c3", "Ann", "Lee", "co1")];
const PAGE_2 = [person("c4", "Tim", "Hart", "co3")];
const FOUND = person("c9", "Jade", "Moss", "co2");
const COMPANIES = [company("co1", "Acme Storage"), company("co2", "Beta Holdings"), company("co3", "Gamma Works")];

const routes: FakeRoute[] = [
  // The KPI cards' numbers: they come up with the rows, not after them.
  {
    match: /\/billing\/invoices\/balances$/,
    reply: () => ({ dueAmount: 100, dueCount: 2, overdueAmount: 50, overdueCount: 1, dueClientCount: 2, overdueClientCount: 1 }),
    delayMs: 90,
  },
  { match: /\/billing\/estimates\/summary$/, reply: () => ({ pending: { count: 7, amount: 1200 } }), delayMs: 70 },
  { match: /\/deals\/client-tags$/, reply: () => [] },
  {
    match: /\/crm\/contacts$/,
    raw: true,
    reply: (url) =>
      url.searchParams.get("cursor")
        ? { success: true, data: PAGE_2, pagination: { count: 1 } }
        : { success: true, data: PAGE_1, pagination: { count: 3, nextCursor: "cur-2" } },
  },
  // The order the browser sees: the rows, then the total, then the sources.
  { match: /\/crm\/contacts\/count$/, reply: () => ({ total: 4641, atLeast: false }), delayMs: 60 },
  { match: /\/deals\/job-sources$/, reply: () => [{ id: "src-1", name: "Google Ads", priority: 1, active: true }], delayMs: 120 },
  {
    match: /\/crm\/companies\/by-ids$/,
    method: "POST",
    reply: (_url, init) => {
      const { ids } = JSON.parse(String(init?.body)) as { ids: string[] };
      return COMPANIES.filter((c) => ids.includes(c.id));
    },
    delayMs: 40,
  },
  { match: /\/search$/, reply: () => ({ query: "ja", mode: "full", groups: [], hits: [{ type: "contact", entityId: "c9" }], total: 1 }) },
  { match: /\/crm\/contacts\/by-ids$/, method: "POST", reply: () => [FOUND] },
];

let server: FakeServer;

const { ContactsPage } = await import("./contacts-page");
const { useClientFieldsStore } = await import("../clients-fields-store");

const text = () => document.body.textContent ?? "";
const rowsUp = () => !!screen.queryByText("Jane Smith");

beforeEach(() => {
  server = installFakeServer(routes);
  // The columns that print something fetched beside the rows: the company, the ad source.
  useClientFieldsStore.setState({ used: ["name", "company", "source", "phone", "created"] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ContactsPage — no jumping", () => {
  it("draws the rows with their companies, sources, the count and the buttons in one frame", async () => {
    const watch = watchFirstFrame(rowsUp, () => ({
      company: screen.queryAllByText("Acme Storage").length > 0,
      source: screen.queryAllByText("Google Ads").length > 0,
      showing: text().includes("Showing 1 to 3 of 4641 results"),
      cards: !!screen.queryByRole("group", { name: "Clients" }) && text().includes("Due from 2 clients") && text().includes("Estimates Pending $1,200"),
      addClient: !!screen.queryByRole("button", { name: /add client/i }),
      skeletons: skeletonCount(),
    }));
    renderWithClient(<ContactsPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ company: true, source: true, showing: true, cards: true, addClient: true, skeletons: 0 });
  });

  it("never says 'Showing 0' while the rows are on their way", async () => {
    let zero = false;
    const observer = new MutationObserver(() => {
      if (text().includes("Showing 0")) zero = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderWithClient(<ContactsPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });
    observer.disconnect();

    expect(zero).toBe(false);
  });

  it("asks for each thing once", async () => {
    renderWithClient(<ContactsPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  it("a search keeps the rows until the matches are in — no empty list, no skeleton, no blank count", async () => {
    renderWithClient(<ContactsPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });

    const seen = { empty: false, skeleton: false, zero: false, rowsWithoutCompany: false };
    const observer = new MutationObserver(() => {
      if (text().includes("No Records Found")) seen.empty = true;
      if (skeletonCount() > 0) seen.skeleton = true;
      if (/Showing 1 to 0/.test(text())) seen.zero = true;
      if (screen.queryByText("Jade Moss") && !screen.queryByText("Beta Holdings")) seen.rowsWithoutCompany = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    // Workiz asks ~1 s after the last key.
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "ja" } });
    await screen.findByText("Showing 1 to 1 of 1 results", {}, { timeout: 4000 });
    observer.disconnect();
    expect(screen.getByText("Jade Moss")).toBeInTheDocument();

    expect(seen).toEqual({ empty: false, skeleton: false, zero: false, rowsWithoutCompany: false });
  });

  it("the next page comes with its companies — the Company column never fills in after the rows", async () => {
    renderWithClient(<ContactsPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });

    let rowsWithoutCompany = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByText("Tim Hart") && !screen.queryByText("Gamma Works")) rowsWithoutCompany = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Tim Hart", {}, { timeout: 3000 });
    observer.disconnect();

    expect(rowsWithoutCompany).toBe(false);
  });
});
