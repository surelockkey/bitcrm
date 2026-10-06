import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ClientType, DealPriority, DealStatus, JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";
import { localDateIso, shiftDateIso } from "../lib";

/**
 * With the app's own query defaults (app/providers.tsx): an answer is fresh
 * for 30 s, so the chat badge that mounts with the day reads the count the
 * page asked for a moment earlier instead of asking again — as it does in the
 * browser. `renderWithClient` runs with no staleTime, where the count (whose
 * hook sets none of its own) would be asked for twice.
 */
function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/**
 * The technician's day appears once, whole.
 *
 * The list used to be drawn the moment the jobs came, and each card then
 * asked for its own client: the name, the number and the Call button arrived
 * card by card, a beat after the card (a row of buttons growing under every
 * job), the job types read "Unknown type" until their catalog came, and the
 * chat badge grew its unread count in the header.
 *
 * Technician-only, so the browser audit (signed in as a dispatcher) never
 * saw it; this renders the real page against a fake server and looks at the
 * very first frame the cards are on screen.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isTechnician: true, isLoading: false, me: { id: "t1" } }),
}));

const today = localDateIso();
const tomorrow = shiftDateIso(today, 1);

const deal = (n: number, over: Partial<Deal>): Deal => ({
  id: `d${n}`,
  dealNumber: `90${n}`,
  contactId: `c${n}`,
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "North",
  address: { street: `${n} Elm St`, city: "Testville", state: "GA", zip: "30001" },
  jobTypeId: "jt-lockout",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedDispatcherId: "u-disp",
  priority: DealPriority.NORMAL,
  assignedTechIds: ["t1"],
  tagIds: [],
  status: DealStatus.ACTIVE,
  createdBy: "u-disp",
  createdAt: "",
  updatedAt: "",
  ...over,
});

const onSite = deal(1, {
  superStatus: JobSuperStatus.IN_PROGRESS,
  subStatusId: "st-onsite",
  scheduledDate: today,
  scheduledTimeSlot: "09:00-11:00",
});
const later = deal(2, { scheduledDate: today, scheduledTimeSlot: "13:00-15:00" });
const next = deal(3, { contactId: "c1", scheduledDate: tomorrow, scheduledTimeSlot: "10:00-12:00" });

const contacts: Record<string, object> = {
  c1: { id: "c1", firstName: "Ivy", lastName: "Quill", phones: ["+14045550123"], emails: [], addresses: [] },
  c2: { id: "c2", firstName: "Otto", lastName: "Brisk", phones: ["+14045550188"], emails: [], addresses: [] },
};

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "t1", firstName: "Tess", lastName: "Tech" }), delayMs: 10 },
  {
    match: /\/deals$/,
    raw: true,
    reply: (url) => {
      const status = url.searchParams.get("superStatus");
      const data = url.searchParams.get("scheduledFrom")
        ? [onSite, later]
        : status === "in_progress"
          ? [onSite]
          : status === "submitted"
            ? [later, next]
            : [];
      return { success: true, data, pagination: {} };
    },
    delayMs: 20,
  },
  {
    match: /\/crm\/contacts\/by-ids$/,
    method: "POST",
    reply: (_url, init) => (JSON.parse(String(init?.body)).ids as string[]).map((id) => contacts[id]),
    delayMs: 40,
  },
  // What each card used to ask for on its own.
  { match: /\/crm\/contacts\/c\d$/, reply: (url) => contacts[url.pathname.split("/").pop()!], delayMs: 40 },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true, priority: 1 }], delayMs: 60 },
  { match: /\/deals\/job-statuses$/, reply: () => [{ id: "st-onsite", name: "On site", active: true, priority: 1 }], delayMs: 50 },
  { match: /\/messaging\/team\/counters$/, reply: () => ({ unreadConversations: 2, unreadByKind: {} }), delayMs: 70 },
];

let server: FakeServer;

/** The day is up: its cards are on screen. */
const cardsAreUp = () => screen.queryAllByTestId("tech-job-card").length > 0;

function watchDayFirstFrame() {
  return watchFirstFrame(cardsAreUp, () => ({
    requestsSoFar: server.requests.length,
    cards: screen.queryAllByTestId("tech-job-card").length,
    clientNames: screen.queryAllByText("Ivy Quill").length === 2 && screen.queryAllByText("Otto Brisk").length === 1,
    phones: screen.queryAllByText("(404) 555-0123").length === 2,
    callButtons: screen.queryAllByRole("button", { name: /call/i }).length,
    unknownType: screen.queryAllByText(/Unknown type/).length,
    subStatus: screen.queryAllByText("On site").length > 0,
    unread: !!screen.queryByTestId("team-chat-unread"),
    count: !!screen.queryByText("3 jobs on your list"),
    skeletons: skeletonCount(),
  }));
}

const { MyJobsPage } = await import("./my-jobs-page");

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MyJobsPage — one load, not waves", () => {
  it("shows the day only once every card has its client, its job type and its status", async () => {
    const watch = watchDayFirstFrame();
    renderWithClient(<MyJobsPage />);
    await screen.findAllByTestId("tech-job-card", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toMatchObject({
      cards: 3,
      clientNames: true,
      phones: true,
      callButtons: 3,
      unknownType: 0,
      subStatus: true,
      unread: true,
      count: true,
      skeletons: 0,
    });
  });

  it("asks for nothing more once the day is on screen", async () => {
    const watch = watchDayFirstFrame();
    renderWithClient(<MyJobsPage />);
    await screen.findAllByTestId("tech-job-card", {}, { timeout: 3000 });
    watch.stop();
    await settle();

    expect(server.requests.slice(watch.frame()!.requestsSoFar)).toEqual([]);
  });

  it("asks for the clients of the whole day at once, and for each thing once", async () => {
    renderWithClient(<MyJobsPage />);
    await screen.findAllByTestId("tech-job-card", {}, { timeout: 3000 });
    await settle();

    const clientAsks = server.requests.filter((r) => r.includes("/crm/contacts")).map((r) => r.replace(/^.*\/crm\//, "/crm/"));
    expect(clientAsks).toEqual(["/crm/contacts/by-ids"]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("draws the chat badge with its count, not without it and then wider", async () => {
    let bareBadge = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByTestId("team-chat-badge") && !screen.queryByTestId("team-chat-unread")) bareBadge = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    renderWithClient(<MyJobsPage />);
    await screen.findAllByTestId("tech-job-card", {}, { timeout: 3000 });
    await settle();
    observer.disconnect();

    expect(bareBadge).toBe(false);
  });

  it("a request that fails does not hold the day off the screen", async () => {
    server.fail(/\/deals\/job-statuses$/);
    renderWithClient(<MyJobsPage />);

    expect(await screen.findAllByTestId("tech-job-card", {}, { timeout: 3000 })).toHaveLength(3);
  });
});
