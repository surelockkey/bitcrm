import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { Contact, Estimate } from "@bitcrm/types";
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
 * The Estimates page does not jump.
 *
 * It came up in waves: the cards read "0 Worth $0.00" and the list "No
 * estimates yet" until the reader's permissions answered, then the cards
 * pulsed "—" over a grey block, then the numbers landed — "25 Worth
 * $3,824,898.95" wraps where "—" did not, so the cards grew and pushed the
 * list down — then the rows, and then their clients and authors a request
 * later. The same again, smaller, on every date window, status and page.
 *
 * Now the cards with their numbers, the rows and the names beside them come
 * in one frame; another window or status keeps what is on screen until the
 * next set is whole.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/estimates",
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
const est = (over: Partial<Estimate>): Estimate =>
  ({
    id: "e1", number: "1042-1", dealId: "d1", dealNumber: "1042", contactId: "c1",
    name: "Front door", status: "pending", estimateDate: "2026-09-16", totals,
    version: 1, createdBy: "u-7", createdAt: "2026-09-16T10:00:00.000Z", updatedAt: "",
    ...over,
  }) as Estimate;

const person = (id: string, firstName: string, lastName: string): Contact =>
  ({ id, firstName, lastName, phones: [], emails: [], addresses: [] }) as unknown as Contact;

const card = (count: number, amount: number) => ({ count, amount });
const summary = (unsent: number) => ({
  unsent: card(unsent, 3813.21), pending: card(98, 1552797.77), approved: card(24, 83828.67),
  declined: card(9, 66932.38), won: card(167, 302977.01), archived: card(127, 325419.46),
  total: card(unsent + 425, 6145758.5),
});

/** What the server answers now — a test may change it mid-way. */
let summaryNow = summary(21);
let rowsNow: Estimate[] = [];

const firstRows = [
  // Imported from Workiz: carries its author's name.
  est({ id: "e1", number: "1042-1", contactId: "c1", createdByName: "Kris Manager" }),
  // Made here: the author comes from the directory.
  est({ id: "e2", number: "1043-1", dealId: "d2", dealNumber: "1043", contactId: "c2" }),
];

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  // The order a slow afternoon shows: the numbers, then the rows, then their names.
  { match: /\/billing\/estimates\/report\/summary$/, reply: () => summaryNow, delayMs: 50 },
  { match: /\/billing\/estimates\/report\/count$/, reply: () => ({ total: rowsNow.length }), delayMs: 30 },
  { match: /\/billing\/estimates\/report$/, reply: () => ({ items: rowsNow }), delayMs: 80 },
  {
    match: /\/crm\/contacts\/by-ids$/,
    reply: (_url, init) => {
      const { ids } = JSON.parse(String(init?.body ?? "{}")) as { ids: string[] };
      const all = [person("c1", "Jane", "Smith"), person("c2", "Bob", "Stone"), person("c9", "Ann", "Other")];
      return all.filter((c) => ids.includes(c.id));
    },
    delayMs: 40,
  },
  {
    match: /\/users$/,
    raw: true,
    reply: () => ({ success: true, data: [{ id: "u-7", firstName: "Lee", lastName: "Office" }], pagination: {} }),
    delayMs: 60,
  },
];

let server: FakeServer;

const { EstimatesPage } = await import("./estimates-page");

/** The big number on a status card, as the reader sees it. */
const cardValue = (caption: string) =>
  screen.queryByRole("button", { name: new RegExp(`${caption}$`) })?.querySelector("span")?.textContent ?? null;
const pageUp = () =>
  screen.queryAllByRole("button", { name: /Worth/ }).length > 0 ||
  !!screen.queryByText("#1042-1") ||
  !!screen.queryByText(/No estimates/);

beforeEach(() => {
  summaryNow = summary(21);
  rowsNow = firstRows;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EstimatesPage — no jumping", () => {
  it("draws the cards with their numbers, the rows and their names in one frame", async () => {
    const watch = watchFirstFrame(pageUp, () => ({
      unsent: cardValue("Unsent"),
      row: !!screen.queryByText("#1042-1"),
      client: !!screen.queryByText("Jane Smith"),
      author: !!screen.queryByText("Added by Lee Office"),
      empty: !!screen.queryByText(/No estimates/),
      skeletons: skeletonCount(),
      asked: server.requests.length,
    }));
    renderWithClient(<EstimatesPage />);
    await screen.findByText("#1042-1", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({
      unsent: "21 Worth $3,813.21",
      row: true,
      client: true,
      author: true,
      empty: false,
      skeletons: 0,
    });
    // Nothing is fetched for what is already on screen.
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("keeps the numbers and the rows on screen while another date window loads", async () => {
    renderWithClient(<EstimatesPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (cardValue("Unsent") === "—" || skeletonCount() > 0 || !screen.queryByText("#1042-1")) blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    summaryNow = summary(7);
    fireEvent.change(screen.getByLabelText("Date range"), { target: { value: "last_month" } });
    await screen.findByText("7 Worth $3,813.21", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blanked).toBe(false);
  });

  it("a status card keeps the rows until the next ones and their clients are in", async () => {
    renderWithClient(<EstimatesPage />);
    await screen.findByText("Jane Smith", {}, { timeout: 3000 });

    let halfDrawn = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0) halfDrawn = true;
      // The next row, drawn before its client is known.
      if (screen.queryByText("#2001-1") && !screen.queryByText("Ann Other")) halfDrawn = true;
      // Nothing on screen at all between the two sets.
      if (!screen.queryByText("#1042-1") && !screen.queryByText("#2001-1")) halfDrawn = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    rowsNow = [est({ id: "e9", number: "2001-1", dealId: "d9", dealNumber: "2001", contactId: "c9", status: "won", createdByName: "Kris Manager" })];
    fireEvent.click(screen.getByRole("button", { name: /Won$/ }));
    await screen.findByText("Ann Other", {}, { timeout: 3000 });
    observer.disconnect();

    expect(halfDrawn).toBe(false);
    expect(screen.queryByText("#1042-1")).not.toBeInTheDocument();
  });
});
