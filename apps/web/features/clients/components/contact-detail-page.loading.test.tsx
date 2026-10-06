import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { ContactSource, ContactType, CrmStatus, JobSuperStatus } from "@bitcrm/types";
import type { Contact, Deal } from "@bitcrm/types";
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
 * The client card appears once, whole.
 *
 * It used to go up the moment the client did and then fill in around the
 * reader: the four cards and the Estimates / Invoices / Payments tabs when
 * the permissions came (pushing the Estimates card and the Addresses tab
 * across), the cards' numbers, the tag chips over grey bars, the Ad source
 * as a raw id and then a name (the sections under it moved down), the jobs
 * table with "Unknown type" and then the type, the portal card's dates and
 * buttons, the Notes badge — each block asking for its own data once it had
 * mounted.
 *
 * This renders the real card against a fake server, the permissions landing
 * after the client as they do in the browser, and looks at the first frame
 * the client's name is on screen: everything the card shows must be in it.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/contacts/c1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const contact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: ["jane@example.com"],
  addresses: [{ street: "1 Main St", city: "Marietta", state: "GA", zip: "30060" }],
  companyId: "co1",
  tagIds: ["t-vip"],
  type: ContactType.COMPANY_REPRESENTATIVE,
  source: ContactSource.MANUAL,
  sourceId: "src-1",
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const deal = (n: number): Deal =>
  ({
    id: `d${n}`,
    dealNumber: `JOB${n}`,
    contactId: "c1",
    address: { street: `${n} Oak Ave`, city: "Marietta", state: "GA", zip: "30060" },
    jobTypeId: "jt-1",
    superStatus: JobSuperStatus.SUBMITTED,
    scheduledDate: "2026-10-01",
    totals: { total: 100, subtotal: 100, discount: 0, tax: 0, cost: 0 },
    createdAt: `2026-09-0${n}T00:00:00.000Z`,
  }) as Deal;

/** How many pages of jobs the server holds for the client — a test may make it a big client. */
let jobPages = 1;

const jobsRoute: FakeRoute = {
  match: /\/deals$/,
  raw: true,
  reply: (url) => {
    if (jobPages === 1) return { success: true, data: [deal(1), deal(2)], pagination: { count: 2 } };
    const page = Number(url.searchParams.get("cursor") ?? "1");
    return { success: true, data: [deal(page)], pagination: { count: 1, nextCursor: page < jobPages ? String(page + 1) : undefined } };
  },
};

const routes: FakeRoute[] = [
  // The order the browser sees: the client first, the permissions a beat later.
  { match: /\/users\/me$/, reply: () => ({ id: "u1", firstName: "Dee", lastName: "Spatch", email: "dee@example.com", roleId: "role-super-admin" }), delayMs: 90 },
  { match: /\/crm\/contacts\/c1$/, reply: () => contact },
  { match: /\/crm\/companies\/co1$/, reply: () => ({ id: "co1", title: "Acme Storage", clientType: "commercial", phones: [], emails: [] }) },
  { match: /\/deals\/client-tags$/, reply: () => [{ id: "t-vip", name: "VIP", color: "blue", priority: 0, active: true }], delayMs: 120 },
  { match: /\/deals\/job-sources$/, reply: () => [{ id: "src-1", name: "Google Ads", priority: 1, active: true }], delayMs: 150 },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-1", name: "Lockout", priority: 1, active: true }], delayMs: 60 },
  jobsRoute,
  {
    match: /\/billing\/invoices$/,
    reply: () => ({ items: [{ id: "i1", dealId: "d1", number: "1001", dueDate: "2026-01-01", status: "sent", createdAt: "2026-09-01", totals: { total: 100, balanceDue: 40, amountPaid: 60 } }] }),
  },
  { match: /\/billing\/estimates$/, reply: () => ({ items: [{ id: "e1", createdAt: "2026-09-01" }, { id: "e2", createdAt: "2026-09-02" }] }) },
  {
    match: /\/billing\/payments$/,
    reply: () => ({ items: [{ id: "p1", dealId: "d1", amount: 60, method: "cash", status: "settled", takenAt: "2026-09-02T10:00:00.000Z" }] }),
  },
  { match: /\/billing\/portal-links\/c1$/, reply: () => ({ contactId: "c1", createdBy: "u1", createdAt: "2026-09-01T00:00:00.000Z", lastViewedAt: "2026-09-03T00:00:00.000Z" }) },
  {
    match: /\/crm\/contacts\/c1\/notes$/,
    raw: true,
    reply: () => ({
      success: true,
      data: [{ id: "n1", contactId: "c1", note: "Gate code", actorId: "u1", actorName: "Dee Spatch", pinned: false, createdAt: "2026-09-01T00:00:00", updatedAt: "2026-09-01T00:00:00" }],
      pagination: { count: 1, notesCount: 1 },
    }),
  },
];

let server: FakeServer;
let client: QueryClient;

const { ContactDetailPage } = await import("./contact-detail-page");

const cardUp = () => !!screen.queryByRole("heading", { name: "Jane Smith" });
const tabText = (name: RegExp) => screen.queryByRole("tab", { name })?.textContent ?? "";

function renderCard() {
  ({ client } = renderWithClient(<ContactDetailPage contactId="c1" />));
}

beforeEach(() => {
  jobPages = 1;
  jobsRoute.delayMs = undefined;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ContactDetailPage — one load, not waves", () => {
  it("shows the card only once everything on it has arrived", async () => {
    const watch = watchFirstFrame(cardUp, () => {
      const rail = screen.queryByRole("complementary", { name: "Client rail" });
      return {
        requestsSoFar: server.requests.length,
        company: screen.queryAllByText("Acme Storage").length > 0,
        tag: !!screen.queryByText("VIP"),
        adSource: !!screen.queryByText("Google Ads"),
        moneyCards: !!screen.queryByText("Past due"),
        jobsTab: tabText(/^Jobs/),
        estimatesTab: tabText(/^Estimates/),
        invoicesTab: tabText(/^Invoices/),
        paymentsTab: tabText(/^Payments/),
        jobType: !!screen.queryAllByText("Lockout").length && !screen.queryByText("Unknown type"),
        portal: !!screen.queryByText("Last viewed"),
        notesBadge: rail ? within(rail).getByRole("button", { name: "Notes" }).textContent : null,
        skeletons: skeletonCount(),
        pulses: document.querySelectorAll(".animate-pulse").length,
      };
    });
    renderCard();
    await screen.findByRole("heading", { name: "Jane Smith" }, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toMatchObject({
      company: true,
      tag: true,
      adSource: true,
      moneyCards: true,
      jobsTab: "Jobs 2",
      estimatesTab: "Estimates 2",
      invoicesTab: "Invoices 1",
      paymentsTab: "Payments 1",
      jobType: true,
      portal: true,
      notesBadge: "Notes1",
      skeletons: 0,
      pulses: 0,
    });
  });

  it("asks for nothing more once the card is on screen", async () => {
    const watch = watchFirstFrame(cardUp, () => ({ requestsSoFar: server.requests.length }));
    renderCard();
    await screen.findByRole("heading", { name: "Jane Smith" }, { timeout: 3000 });
    watch.stop();
    await settle();

    expect(server.requests.slice(watch.frame()!.requestsSoFar)).toEqual([]);
  });

  it("asks for each thing once", async () => {
    renderCard();
    await screen.findByRole("heading", { name: "Jane Smith" }, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  /** Behind the skeleton would go the office's open popups and drafts. */
  it("once shown, a refetch never takes the card back to the skeleton", async () => {
    renderCard();
    await screen.findByRole("heading", { name: "Jane Smith" }, { timeout: 3000 });

    let lost = false;
    const observer = new MutationObserver(() => {
      if (!cardUp()) lost = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await client.invalidateQueries();
    await settle();
    observer.disconnect();

    expect(lost).toBe(false);
  });

  it("a request that fails does not hold the card off the screen", async () => {
    server.fail(/\/crm\/contacts\/c1\/notes$/);
    renderCard();

    expect(await screen.findByRole("heading", { name: "Jane Smith" }, { timeout: 3000 })).toBeInTheDocument();
  });

  /**
   * A big client's jobs come fifty at a time. The card waits for the first
   * few pages, not for hundreds of jobs; the Jobs number then says "at
   * least" and holds still until the count is final — it does not tick up
   * page by page, pushing the tabs beside it across each time.
   */
  it("a big client: up after the first pages, and the Jobs number changes once, to the final count", async () => {
    jobPages = 6;
    // A page a beat: the card waits on nothing but the jobs.
    jobsRoute.delayMs = 80;
    const badges: string[] = [];
    const addresses: string[] = [];
    const observer = new MutationObserver(() => {
      const t = tabText(/^Jobs/);
      if (t && badges.at(-1) !== t) badges.push(t);
      const a = tabText(/^Addresses/);
      if (a && addresses.at(-1) !== a) addresses.push(a);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderCard();
    await screen.findByRole("heading", { name: "Jane Smith" }, { timeout: 3000 });
    await screen.findByRole("tab", { name: "Jobs 6" }, { timeout: 3000 });
    observer.disconnect();

    expect(badges).toEqual(["Jobs 4+", "Jobs 6"]);
    // The client's own address plus one per job's.
    expect(addresses).toEqual(["Addresses 5+", "Addresses 7"]);
  });
});
