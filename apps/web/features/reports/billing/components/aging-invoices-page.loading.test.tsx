import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgingBucket, AgingReport } from "@bitcrm/types";
import {
  declaredRowHeights,
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  watchLoadingRowHeights,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";

/**
 * Aging invoices does not jump.
 *
 * The five cards were drawn at once holding "—" and filled when the report
 * came: right-aligned, a "$235,074.06" starts far to the left of a "—", so
 * every figure slid; the note about the unpaid-invoice index came with the
 * data, pushing the grid down. Now the cards, their figures, the note and
 * the table come in one frame (Workiz-grey card skeletons and the grid's own
 * loader before it), and another card keeps the figures on screen until the
 * new rows are in.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const perms = vi.hoisted(() => ({ loading: false, money: true }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  // While the matrix loads, `can` says no to everything — as the real one does.
  usePermissions: () => ({
    can: (resource: string) => !perms.loading && (resource !== "financials" || perms.money),
    isLoading: perms.loading,
  }),
}));

const report = (bucket: AgingBucket): AgingReport => ({
  asOf: "2026-10-06",
  bucket,
  cards: {
    all: { count: 12, amount: 23507.06 },
    under30: { count: 3, amount: 2005.78 },
    from30to60: { count: 2, amount: 521.06 },
    from60to90: { count: 0, amount: 0 },
    over90: { count: 7, amount: 980.22 },
  },
  items: [
    {
      invoiceId: `inv-${bucket}`,
      dealId: "d1",
      number: bucket === "all" ? "INV100" : "INV900",
      contactId: "c1",
      clientName: "Test Client",
      total: 100,
      balance: 100,
      dueDate: "2026-06-01",
      createdAt: "2026-06-01T15:00:00.000Z",
      daysLate: 127,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 10,
  // Not built here: the note about it comes with the figures.
  indexReady: false,
});

const routes: FakeRoute[] = [
  { match: /\/billing\/invoices\/aging$/, reply: (url) => report((url.searchParams.get("bucket") ?? "all") as AgingBucket), delayMs: 60 },
];

let server: FakeServer;

const { AgingInvoicesPage } = await import("./aging-invoices-page");

const cards = () => [...document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
const cardsUp = () => cards().length > 0;

beforeEach(() => {
  perms.loading = false;
  perms.money = true;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * app_audit → probe_shift 2026-10-09 (CLS 0.08): with the permissions still
 * on their way the loader drew the grid without Total and Balance, and when
 * they answered the two columns came in and every cell to their left
 * narrowed. The loader now guesses the full grid — most readers have the
 * money — and a reader the permissions keep from it gets a grid drawn anew,
 * not reshuffled.
 */
describe("AgingInvoicesPage — the columns while the permissions load", () => {
  const headers = () => [...document.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
  const grid = () => document.querySelector('[data-slot="wz-report-grid"]');
  // A mocked permissions hook cannot wake the page; re-rendering it under the same client can.
  const mount = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = () => (
      <QueryClientProvider client={client}>
        <AgingInvoicesPage />
      </QueryClientProvider>
    );
    const { rerender } = render(ui());
    return () => rerender(ui());
  };

  it("guesses the money columns while the permissions load and keeps the very grid once they confirm it", async () => {
    perms.loading = true;
    const rerender = mount();
    const first = grid();
    expect(headers()).toEqual(expect.arrayContaining(["Total", "Balance"]));

    perms.loading = false;
    rerender();
    expect(grid()).toBe(first);
    await screen.findByText("INV100", {}, { timeout: 3000 });
    expect(grid()).toBe(first);
    expect(headers()).toEqual(expect.arrayContaining(["Total", "Balance"]));
  });

  it("draws the grid anew — not reshuffled — for a reader the permissions keep from the money", () => {
    perms.loading = true;
    perms.money = false;
    const rerender = mount();
    const first = grid();

    perms.loading = false;
    rerender();
    expect(headers()).not.toContain("Total");
    expect(first!.isConnected).toBe(false);
  });
});

describe("AgingInvoicesPage — no jumping", () => {
  it("draws the cards with their figures, the note and the table in one frame", async () => {
    const watch = watchFirstFrame(cardsUp, () => ({
      figures: cards().map((c) => c.querySelector("div")?.textContent),
      note: !!screen.queryByText(/unpaid-invoice index is not built/),
      table: !!screen.queryByText("INV100"),
      skeletons: skeletonCount(),
    }));
    renderWithClient(<AgingInvoicesPage />);
    await screen.findByText("INV100", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({
      figures: ["$23,507.06", "$2,005.78", "$521.06", "$0.00", "$980.22"],
      note: true,
      table: true,
      skeletons: 0,
    });
  });

  it("keeps the figures on screen while another card loads", async () => {
    renderWithClient(<AgingInvoicesPage />);
    await screen.findByText("INV100", {}, { timeout: 3000 });
    await settle();

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0 || cards().some((c) => c.textContent?.startsWith("—"))) blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    fireEvent.click(cards()[4]);
    await screen.findByText("INV900", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blanked).toBe(false);
  });

  it("asks for each thing once", async () => {
    renderWithClient(<AgingInvoicesPage />);
    await screen.findByText("INV100", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  // app_audit 2026-10-09: CLS 0.08 — the loader's 57px blanks became 82px
  // rows (a client's name over their email, rep_aging) and the grid grew
  // under the reader. The blanks, the records and the filler now all declare
  // Workiz's 82px, so the rows land exactly where the blanks were.
  it("lands its rows on the loader's blank rows — the same declared row height before and after", async () => {
    const watch = watchLoadingRowHeights();
    renderWithClient(<AgingInvoicesPage />);
    await screen.findByText("INV100", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual(["82px"]);
    expect(declaredRowHeights()).toEqual(["82px"]);
  });
});
