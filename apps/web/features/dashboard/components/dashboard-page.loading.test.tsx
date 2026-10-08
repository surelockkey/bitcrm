import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
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
 * The dashboard does not jump.
 *
 * Every card was drawn at once — its frame, its title, its range picker —
 * around a grey bar of a guessed height, and the bodies filled in together
 * when the opening bundle came. A pie or a scoreboard is not the height of
 * its bar, so each row of cards moved the rows under it (Top Call Flows,
 * Service Areas, the scoreboards, Recent Calls), and before all that a
 * spinner stood in for the page while the role was read.
 *
 * Now one skeleton holds the page from the first frame, and the cards come
 * in one frame, filled.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The role is read from the server, as the app reads it — a beat before the bundle is asked for.
vi.mock("@/features/auth/use-permissions", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const useMe = () =>
    useQuery({ queryKey: ["me"], queryFn: () => fetch("/api/users/me").then((r) => r.json()), staleTime: Infinity });
  return {
    useDenied: () => () => false,
    usePermissions: () => {
      const me = useMe();
      return { can: () => !me.isLoading, isLoading: me.isLoading, isTechnician: false, me: me.data };
    },
  };
});

const window30 = { from: "2026-09-22", to: "2026-10-06" }; // Workiz's Last 14 days
const shares = (name: string) => ({
  slices: [
    { key: "a", name: `${name} A`, count: 3, percent: 60 },
    { key: "b", name: `${name} B`, count: 2, percent: 40 },
  ],
  computedAt: "2026-10-06T07:00:00.000Z",
});
const board = { rows: [{ id: "u1", name: "Ann Lee", jobs: 4, sales: 1200 }], computedAt: "2026-10-06T07:00:00.000Z" };

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, raw: true, reply: () => ({ id: "u-office" }), delayMs: 10 },
  {
    match: /\/deals\/stats\/dashboard$/,
    reply: () => ({
      sales: { days: [{ date: window30.to, total: 500, net: 400 }], total: 500, net: 400, computedAt: "2026-10-06T07:00:00.000Z" },
      topSources: shares("Source"),
      topJobTypes: shares("Type"),
      serviceAreas: shares("Area"),
      techScoreboard: board,
      dispatchScoreboard: board,
      today: { sales: 300, jobsDone: 2, jobsCanceled: 0, jobsCreated: 5 },
      jobsNow: { byStatus: { submitted: 1, pending: 2, in_progress: 3, done_pending_approval: 0 } },
      jobsByStatus: { days: [{ day: window30.to, canceled: 0, open: 2, done: 1 }], atLeast: false, computedAt: "2026-10-06T07:00:00.000Z" },
    }),
    delayMs: 60,
  },
  {
    match: /\/telephony\/calls\/stats\/dashboard$/,
    reply: () => ({
      topCallFlows: { days: [window30.to], flows: [{ name: "Main line", counts: [7] }], atLeast: false, computedAt: "2026-10-06T07:00:00.000Z" },
      recentCalls: [],
    }),
    delayMs: 90,
  },
  // Workiz Home's widgets beyond the two stats services — in the same gate.
  {
    match: /\/billing\/invoices\/report\/summary$/,
    reply: () => ({ due: { count: 3, amount: 900 }, overdue: { count: 1, amount: 100 }, unsent: { count: 0 }, needInvoices: { count: 0 }, indexReady: true }),
    delayMs: 40,
  },
  {
    match: /\/billing\/estimates\/report\/summary$/,
    reply: () => ({
      unsent: { count: 1, amount: 10 },
      pending: { count: 2, amount: 20 },
      approved: { count: 0, amount: 0 },
      declined: { count: 0, amount: 0 },
      won: { count: 0, amount: 0 },
      archived: { count: 0, amount: 0 },
      total: { count: 3, amount: 30 },
    }),
    delayMs: 50,
  },
  {
    match: /\/deals$/,
    raw: true,
    reply: (url) =>
      url.searchParams.get("superStatus") === "pending"
        ? {
            success: true,
            data: [
              {
                id: "d1",
                contactId: "c1",
                scheduledDate: "2026-10-06",
                scheduledTimeSlot: "14:00-15:00",
                address: { street: "40 Mansfield St", city: "Bethel", state: "Connecticut", zip: "" },
              },
            ],
            pagination: {},
            included: { technicians: [], clients: [{ id: "c1", firstName: "Wati", lastName: "Bukhari" }] },
          }
        : { success: true, data: [], pagination: {} },
    delayMs: 30,
  },
  {
    match: /\/deals\/activity$/,
    raw: true,
    reply: () => ({
      success: true,
      data: [
        {
          id: "a1",
          timestamp: "2026-10-06T09:00:00.000Z",
          actorId: "w1",
          actorName: "(1) (Evelyn) 2 Dispatcher",
          imported: true,
          text: "Update job details",
          dealId: "d1",
          jobRef: "C2ZNRU",
        },
      ],
      pagination: {},
    }),
    delayMs: 45,
  },
  { match: /\/users\/by-ids$/, reply: () => [], delayMs: 15 },
  {
    match: /\/billing\/payments\/report\/totals$/,
    reply: () => ({ count: 1, amount: 250, tips: 0, serviceFees: 0, byType: {} }),
    delayMs: 35,
  },
];

const TITLES = [
  "Top Sources",
  "Jobs By Status",
  "Invoices",
  "Sales",
  "Top Job Types",
  "Estimates",
  "Coming up",
  "Service Areas",
  "Top Call Flows",
  "Recent Activity",
  "Dispatch Scoreboard",
  "Recent Calls",
  "Tech Scoreboard",
  "Jobs",
  "Today",
];

let server: FakeServer;

const { default: RootPage } = await import("@/app/(app)/page");

const headings = () => [...document.querySelectorAll("h2")].map((h) => h.textContent ?? "");
const cardsUp = () => headings().some((h) => TITLES.includes(h));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date("2026-10-06T16:00:00.000Z") });
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = () =>
  renderWithClient(
    <TooltipProvider>
      <RootPage />
    </TooltipProvider>,
  );

describe("the dashboard — no jumping", () => {
  it("draws every card, filled, in one frame", async () => {
    const watch = watchFirstFrame(cardsUp, () => ({
      cards: headings().filter((h) => TITLES.includes(h)).length,
      skeletons: skeletonCount(),
      pie: screen.queryAllByText("Source A").length > 0,
      board: screen.queryAllByText("Ann Lee").length,
      flows: screen.queryAllByText("Main line").length > 0,
      invoices: screen.queryAllByText("$900.00").length > 0,
      coming: screen.queryAllByText("Wati Bukhari").length > 0,
      activity: screen.queryAllByText("Update job details").length > 0,
      collected: screen.queryAllByText("$250.00").length > 0,
    }));
    render();
    await screen.findAllByText("Source A", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({
      cards: TITLES.length,
      skeletons: 0,
      pie: true,
      board: 2,
      flows: true,
      invoices: true,
      coming: true,
      activity: true,
      collected: true,
    });
  });

  it("holds one skeleton from the first frame — no spinner before it", async () => {
    let spinner = false;
    const observer = new MutationObserver(() => {
      if (document.querySelector(".animate-spin")) spinner = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    render();
    const first = { skeletons: skeletonCount(), spinner: !!document.querySelector(".animate-spin") };
    await screen.findAllByText("Source A", {}, { timeout: 3000 });
    observer.disconnect();

    expect(first.skeletons).toBeGreaterThan(0);
    expect(first.spinner || spinner).toBe(false);
  });

  it("asks each source once, and nothing card by card", async () => {
    render();
    await screen.findAllByText("Source A", {}, { timeout: 3000 });
    await settle();

    const asked = server.requests.map((r) => r.split("?")[0]);
    expect(asked.sort()).toEqual(
      [
        "/api/billing/estimates/report/summary",
        "/api/billing/invoices/report/summary",
        "/api/billing/payments/report/totals",
        // Coming up: one page per open status, in visit order.
        "/api/deals",
        "/api/deals",
        "/api/deals",
        "/api/deals/activity",
        "/api/deals/stats/dashboard",
        "/api/telephony/calls/stats/dashboard",
        // The scoreboards' people, named once for both.
        "/api/users/by-ids",
        "/api/users/me",
      ].sort(),
    );
    expect(duplicates(server.requests)).toEqual([]);
  });
});
