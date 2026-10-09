import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { PaymentTerms, type Contact, type Invoice } from "@bitcrm/types";
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
 * The Invoices page does not jump.
 *
 * Until the reader's permissions answered, the cards read "$0.00" and the
 * list "No invoices match"; then the cards pulsed "—" over a grey block; the
 * rows came, and their clients a request later — with the email under the
 * name, so each row grew and pushed the ones under it; and last the summary
 * (the slowest of the lot), whose "Needs invoice · 29" widened the view
 * switch and slid the date presets beside it.
 *
 * Now (Workiz's layout, pg_invoices) the four cards — "29 jobs / Need
 * invoices" among them — the rows and their clients come in one frame;
 * another window or filter keeps what is on screen until the next set is
 * whole.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/invoices",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const totals = {
  lineCount: 1, subtotal: 100, taxableSubtotal: 100, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 100, taxRatePercent: 0, tax: 0, total: 100, amountPaid: 0, balanceDue: 100,
};
const inv = (over: Partial<Invoice>): Invoice => ({
  id: "d1", number: "1042", dealId: "d1", contactId: "c1", invoiceDate: "2026-09-16",
  paymentTerms: PaymentTerms.CASH, dueDate: "2026-09-16", status: "due", totals, version: 1,
  createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "", ...over,
});

const person = (id: string, firstName: string, lastName: string, email: string): Contact =>
  ({ id, firstName, lastName, phones: [], emails: [email], addresses: [] }) as unknown as Contact;

const summary = (due: number) => ({
  due: { count: 3, amount: due }, overdue: { count: 1, amount: 99 }, unsent: { count: 4 }, needInvoices: { count: 29 }, indexReady: true,
});

/** What the server answers now — a test may change it mid-way. */
let summaryNow = summary(1234.5);
let rowsNow: Invoice[] = [];

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  // The order dev shows: the rows first, their clients, and the summary last.
  { match: /\/billing\/invoices\/report\/summary$/, reply: () => summaryNow, delayMs: 140 },
  { match: /\/billing\/invoices\/report\/count$/, reply: () => ({ total: rowsNow.length, atLeast: false }), delayMs: 30 },
  { match: /\/billing\/invoices\/report$/, reply: () => ({ items: rowsNow }), delayMs: 50 },
  {
    match: /\/crm\/contacts\/by-ids$/,
    reply: (_url, init) => {
      const { ids } = JSON.parse(String(init?.body ?? "{}")) as { ids: string[] };
      const all = [person("c1", "Jane", "Smith", "jane@client.test"), person("c9", "Ann", "Other", "ann@client.test")];
      return all.filter((c) => ids.includes(c.id));
    },
    delayMs: 40,
  },
];

let server: FakeServer;

const { InvoicesPage } = await import("./invoices-page");

/** The big number on a card, as the reader sees it (the card's first line). */
const cardValue = (caption: RegExp) =>
  screen.queryByRole("button", { name: caption })?.querySelector("div")?.textContent ?? null;
const needsCard = () => cardValue(/Need invoices/);
/** An invoice number on screen — its own cell and the Job link both print it. */
const shows = (text: string) => screen.queryAllByText(text).length > 0;
const pageUp = () => !!screen.queryByRole("button", { name: /Due from/ }) || shows("1042") || shows("No Records Found");

beforeEach(() => {
  summaryNow = summary(1234.5);
  rowsNow = [inv({})];
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InvoicesPage — no jumping", () => {
  it("draws the four cards, the rows and their clients in one frame", async () => {
    const watch = watchFirstFrame(pageUp, () => ({
      due: cardValue(/Due from/),
      needs: needsCard(),
      row: shows("1042"),
      client: !!screen.queryByText("Jane Smith"),
      email: !!screen.queryByText("jane@client.test"),
      empty: shows("No Records Found"),
      skeletons: skeletonCount(),
      asked: server.requests.length,
    }));
    renderWithClient(<InvoicesPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({
      due: "$1,234.50",
      needs: "29 jobs",
      row: true,
      client: true,
      email: true,
      empty: false,
      skeletons: 0,
    });
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("keeps the numbers and the rows on screen while another date window loads", async () => {
    renderWithClient(<InvoicesPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (cardValue(/Due from/) === null || needsCard() === null) blanked = true;
      if (skeletonCount() > 0 || !shows("1042")) blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    summaryNow = summary(77);
    fireEvent.click(screen.getByRole("button", { name: /^Date range/ }));
    fireEvent.click(screen.getByRole("option", { name: "Last month" }));
    await screen.findByText("$77.00", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blanked).toBe(false);
  });

  it("a card keeps the rows until the next ones and their clients are in", async () => {
    renderWithClient(<InvoicesPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });

    let halfDrawn = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0) halfDrawn = true;
      if (shows("2001") && !screen.queryByText("Ann Other")) halfDrawn = true;
      if (!shows("1042") && !shows("2001")) halfDrawn = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    rowsNow = [inv({ id: "d9", dealId: "d9", number: "2001", contactId: "c9", status: "overdue" })];
    fireEvent.click(screen.getByRole("button", { name: /Overdue from/ }));
    await screen.findByText("Ann Other", {}, { timeout: 3000 });
    observer.disconnect();

    expect(halfDrawn).toBe(false);
    expect(shows("1042")).toBe(false);
  });
});
