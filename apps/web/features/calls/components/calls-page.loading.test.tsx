import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
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
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CallRecord } from "../lib";

/**
 * The call log does not jump.
 *
 * The rows came first and everything printed in them came after, each on its
 * own beat: the linked jobs were asked for once the rows were in, and the
 * job-tag catalog only once those jobs had mounted their chips — which are
 * taller than the dash they replace, so every row below a tagged job slid
 * down (CLS 0.50 on a full page). The role badges, the source names, the
 * call-tag chips and the "of N" under the table filled in the same way, the
 * live strip landed above the table and pushed it, and the page said
 * "No access" until the permissions arrived.
 *
 * Now the log appears once, whole: one skeleton, then the rows with
 * everything they print, the live strip and the filters in the same frame.
 * Going to the next page keeps the current one until the next one is whole.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/calls",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const perms = vi.hoisted(() => ({ isLoading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    // Nothing is allowed until the permissions are in — as the real hook does.
    can: () => !perms.isLoading,
    isTechnician: false,
    isLoading: perms.isLoading,
    me: { id: "u-disp" },
  }),
}));
// The stream is a live channel, not a page load.
vi.mock("../use-call-stream", () => ({ useCallStream: () => undefined }));

const call = (n: number, patch: Partial<CallRecord> = {}): CallRecord => ({
  callSid: `CA${n}`,
  direction: "inbound",
  from: `+1404555${String(1000 + n)}`,
  to: "+14045550100",
  status: "completed",
  startedAt: `2026-10-0${n}T10:00:00.000Z`,
  updatedAt: `2026-10-0${n}T10:05:00.000Z`,
  durationSeconds: 60,
  ...patch,
});

const page1 = [
  call(1, {
    fromParty: { kind: "contact", id: "c1", name: "Jane Roe" },
    toParty: { kind: "user", id: "u1", name: "Sam Agent", roleId: "r-desk" },
    dealId: "d1",
    sourceId: "src-1",
    tagIds: ["ct-1"],
  }),
  call(2, { dealId: "d2" }),
];
const page2 = [call(3, { fromParty: { kind: "contact", id: "c3", name: "Lee Park" }, dealId: "d3" })];

const deals: Record<string, { id: string; dealNumber: string; tagIds: string[] }> = {
  d1: { id: "d1", dealNumber: "1042", tagIds: ["jt-1"] },
  d2: { id: "d2", dealNumber: "1043", tagIds: [] },
  d3: { id: "d3", dealNumber: "2001", tagIds: ["jt-1"] },
};

const routes: FakeRoute[] = [
  {
    match: /\/telephony\/calls$/,
    raw: true,
    reply: (url) =>
      url.searchParams.get("cursor") === "p2"
        ? { success: true, data: page2, pagination: {} }
        : { success: true, data: page1, pagination: { nextCursor: "p2" } },
  },
  // The order the browser sees: the rows first, everything they print later.
  { match: /\/telephony\/calls\/count$/, reply: () => ({ total: 3, atLeast: false }), delayMs: 90 },
  // The stat cards' numbers, and the number pill beside the heading.
  {
    match: /\/telephony\/calls\/stats\/summary$/,
    reply: () => ({ calls: 3, callers: 2, missed: 1, active: 1, jobs: 1, revenue: 120, atLeast: false }),
    delayMs: 110,
  },
  { match: /\/messaging\/settings$/, reply: () => ({ defaultSenderNumber: "+12034036303" }), delayMs: 100 },
  {
    match: /\/telephony\/calls\/live$/,
    reply: () => [call(9, { status: "in-progress", fromParty: { kind: "contact", id: "c9", name: "Live Caller" } })],
    delayMs: 70,
  },
  { match: /\/telephony\/call-tags$/, reply: () => [{ id: "ct-1", name: "Spam caller", color: "red", active: true }], delayMs: 60 },
  { match: /\/users\/roles$/, reply: () => [{ id: "r-desk", name: "Front desk" }], delayMs: 60 },
  { match: /\/deals\/job-sources$/, reply: () => [{ id: "src-1", name: "Yard signs", active: true, priority: 0 }], delayMs: 60 },
  { match: /\/deals\/job-tags$/, reply: () => [{ id: "jt-1", name: "Warranty", color: "blue", active: true }], delayMs: 40 },
  {
    match: /\/deals\/by-ids$/,
    method: "POST",
    reply: (_url, init) => (JSON.parse(String(init?.body)).ids as string[]).map((id) => deals[id]),
    delayMs: 30,
  },
];

let server: FakeServer;

const { CallsPage } = await import("./calls-page");

/** The app shell provides the tooltip layer; the live strip's Listen/Join need it. */
const renderPage = () =>
  renderWithClient(
    <TooltipProvider>
      <CallsPage />
    </TooltipProvider>,
  );

const rowsUp = () => !!screen.queryByText("Jane Roe");
/** The grey bars a cell shows while what it prints is still on its way. */
const placeholders = () => document.querySelectorAll(".animate-pulse.bg-muted").length;
/** The filter row, the cards and the strip: drawn invisible until the page is whole. */
const controls = () => screen.queryByTestId("calls-controls");
const filtersShown = () => !!controls() && !controls()!.className.split(/\s+/).includes("invisible");
/** The headset's red count of calls in progress. */
const liveCount = () => screen.queryByRole("button", { name: "Monitor calls" })?.textContent ?? "";

beforeEach(() => {
  localStorage.clear();
  perms.isLoading = false;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CallsPage — no jumping", () => {
  it("draws the rows with everything they print, the cards, the pill, the live count and the filters in one frame", async () => {
    const watch = watchFirstFrame(rowsUp, () => ({
      job: !!screen.queryByText("Job 1042"),
      role: !!screen.queryByText("Front desk"),
      source: !!screen.queryByText("Yard signs"),
      callTag: !!screen.queryByText("Spam caller"),
      total: /of 3/.test(screen.queryByTestId("list-pagination")?.textContent ?? ""),
      cards: !!screen.queryByRole("group", { name: "MISSED CALLS" }),
      pill: !!screen.queryByText("(203) 403-6303"),
      live: liveCount() === "1",
      filters: filtersShown(),
      placeholders: placeholders(),
      skeletons: skeletonCount(),
    }));
    renderPage();
    await screen.findByText("Jane Roe", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({
      job: true,
      role: true,
      source: true,
      callTag: true,
      total: true,
      cards: true,
      pill: true,
      live: true,
      filters: true,
      placeholders: 0,
      skeletons: 0,
    });
  });

  it("never shows the filters before the cards, the pill and the live count are in", async () => {
    let early = false;
    const observer = new MutationObserver(() => {
      if (
        filtersShown() &&
        (!screen.queryByRole("group", { name: "MISSED CALLS" }) || !screen.queryByText("(203) 403-6303") || liveCount() !== "1")
      ) {
        early = true;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    renderPage();
    await screen.findByText("Jane Roe", {}, { timeout: 3000 });
    observer.disconnect();

    expect(early).toBe(false);
  });

  it("waits for the permissions instead of saying No access", async () => {
    perms.isLoading = true;
    renderPage();
    await settle(50);

    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading calls" })).toBeInTheDocument();
  });

  it("asks for each thing once", async () => {
    renderPage();
    await screen.findByText("Jane Roe", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  it("turns to the next page once it is whole, with its jobs", async () => {
    renderPage();
    await screen.findByText("Jane Roe", {}, { timeout: 3000 });
    await settle();

    const watch = watchFirstFrame(
      () => !!screen.queryByText("Lee Park"),
      () => ({ job: !!screen.queryByText("Job 2001"), placeholders: placeholders() }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    });
    await screen.findByText("Lee Park", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ job: true, placeholders: 0 });
    // The rows of the first page are gone, not left under the second's numbers.
    expect(screen.queryByText("Jane Roe")).not.toBeInTheDocument();
  });
});
