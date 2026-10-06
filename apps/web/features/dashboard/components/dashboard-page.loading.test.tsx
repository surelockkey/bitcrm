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

const window30 = { from: "2026-09-06", to: "2026-10-06" };
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
];

const TITLES = [
  "Top Sources",
  "Sales",
  "Top Job Types",
  "Service Areas",
  "Top Call Flows",
  "Dispatch Scoreboard",
  "Recent Calls",
  "Tech Scoreboard",
  "Jobs",
  "Today",
  "Jobs By Status",
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
    }));
    render();
    await screen.findAllByText("Source A", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ cards: TITLES.length, skeletons: 0, pie: true, board: 2, flows: true });
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

  it("asks the two services once each, and nothing card by card", async () => {
    render();
    await screen.findAllByText("Source A", {}, { timeout: 3000 });
    await settle();

    const asked = server.requests.map((r) => r.split("?")[0]);
    expect(asked.sort()).toEqual(["/api/deals/stats/dashboard", "/api/telephony/calls/stats/dashboard", "/api/users/me"]);
    expect(duplicates(server.requests)).toEqual([]);
  });
});
