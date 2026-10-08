import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { ClientType, DealPriority, DealStatus, JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
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
 * The schedule appears once, whole — and a new day turns it over once.
 *
 * It used to come in waves: "No access" while the permissions were on their
 * way, jobs reading "N/A" until the job types came and "Unassigned" until the
 * directory named their technicians, the unscheduled count late, the time off
 * last of all — and the calendar asked for again for every page of the
 * roster. A new day emptied the grid and filled it the same way.
 *
 * This renders the real page against a fake server and looks at the very
 * first frame the grid shows: everything on it must already be in, and
 * nothing more may be asked for afterwards.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));

const perms = vi.hoisted(() => ({ loading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  // Never a refusal: deals.view is granted, or still on its way.
  useDenied: () => () => false,
  usePermissions: () => ({
    // While the matrix loads, `can` says no to everything — as the real one does.
    can: () => !perms.loading,
    isLoading: perms.loading,
    isTechnician: false,
    me: perms.loading ? undefined : { id: "u-disp" },
  }),
}));

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// The calendar opens on the browser's today, as Workiz's does.
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + MS_PER_DAY).toISOString().slice(0, 10);

const deal = (n: number, day: string): Deal => ({
  id: `d${n}`,
  dealNumber: `80${n}`,
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
  scheduledDate: day,
  scheduledTimeSlot: "09:00-11:00",
});

const byDay: Record<string, Deal[]> = { [today]: [deal(1, today)], [tomorrow]: [deal(2, tomorrow)] };
// One job with no visit date: the toolbar counts it, the pane names its client.
const undated: Deal = { ...deal(3, today), scheduledDate: undefined, scheduledTimeSlot: undefined, assignedTechIds: [] };
const contacts: Record<string, { id: string; firstName: string; lastName: string }> = {
  c3: { id: "c3", firstName: "Ivy", lastName: "Quill" },
};

const profile = (userId: string) => ({
  userId,
  status: "active",
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  workStart: "08:00",
  workEnd: "17:00",
});
const users = [
  { id: "t1", firstName: "Sam", lastName: "Reyes", email: "sam@example.test", roleId: "role-tech" },
  { id: "t2", firstName: "Nia", lastName: "Holt", email: "nia@example.test", roleId: "role-tech" },
  // On the roster, but off the field team: no Timeline row for them.
  { id: "t3", firstName: "Gus", lastName: "Desk", email: "gus@example.test", fieldTeamMember: false },
];

/** Pages of a drained list: one row a page, the cursor its index. */
const paged = <T,>(rows: T[]) => (url: URL) => {
  const i = Number(url.searchParams.get("cursor") ?? 0);
  return { success: true, data: [rows[i]], pagination: { nextCursor: i + 1 < rows.length ? String(i + 1) : undefined } };
};

const routes: FakeRoute[] = [
  {
    match: /\/deals$/,
    raw: true,
    reply: (url) => ({
      success: true,
      data:
        url.searchParams.get("unscheduled") === "true" ? [undated] : (byDay[url.searchParams.get("scheduledFrom") ?? ""] ?? []),
      pagination: {},
    }),
    delayMs: 30,
  },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Car lockout", active: true }], delayMs: 50 },
  { match: /\/users\/roles$/, reply: () => [{ id: "role-tech", name: "tech" }], delayMs: 45 },
  {
    match: /\/crm\/contacts\/by-ids$/,
    method: "POST",
    reply: (_url, init) => (JSON.parse(String(init?.body)).ids as string[]).map((id) => contacts[id]),
    delayMs: 30,
  },
  // The roster drains over three pages, the directory over three more.
  { match: /\/users\/technicians$/, raw: true, reply: paged([profile("t1"), profile("t2"), profile("t3")]), delayMs: 15 },
  { match: /\/users$/, raw: true, reply: paged(users), delayMs: 40 },
  {
    match: /\/users\/technicians\/calendar-events$/,
    reply: (url) =>
      url.searchParams.get("from") === today
        ? [{ id: "ev1", technicianId: "t2", type: "time_off", title: "Dentist", startDate: today, endDate: today, allDay: true }]
        : [],
    delayMs: 40,
  },
];

let server: FakeServer;

/** The grid is up: its scroller is drawn. */
const gridIsUp = () => !!document.querySelector("[data-schedule-scroll]");
const jobText = (n: string) => screen.queryByRole("button", { name: `Job ID: ${n}` })?.textContent ?? "";

function watchGridFirstFrame() {
  return watchFirstFrame(gridIsUp, () => ({
    requestsSoFar: server.requests.length,
    // The template's job type and technician, already named.
    jobBlock: /801\s+Car lockout,[\s\S]*Sam Reyes/.test(jobText("801")),
    timeOff: !!screen.queryByText(/Dentist - Nia Holt/),
    unscheduledCount: screen.queryByRole("button", { name: "Unscheduled jobs" })?.textContent === "1",
    skeletons: skeletonCount(),
  }));
}

const { SchedulePage } = await import("./schedule-page");

beforeEach(() => {
  perms.loading = false;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SchedulePage — one load, not waves", () => {
  it("shows the grid only once everything on it has arrived", async () => {
    const watch = watchGridFirstFrame();
    renderWithClient(<SchedulePage />);
    await vi.waitFor(() => expect(gridIsUp()).toBe(true), { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toMatchObject({
      jobBlock: true,
      timeOff: true,
      unscheduledCount: true,
      skeletons: 0,
    });
  });

  it("shows one skeleton until then", async () => {
    renderWithClient(<SchedulePage />);
    expect(skeletonCount()).toBe(1);
    await vi.waitFor(() => expect(gridIsUp()).toBe(true), { timeout: 3000 });
    expect(skeletonCount()).toBe(0);
  });

  it("asks for nothing more once the grid is on screen", async () => {
    const watch = watchGridFirstFrame();
    renderWithClient(<SchedulePage />);
    await vi.waitFor(() => expect(gridIsUp()).toBe(true), { timeout: 3000 });
    watch.stop();
    await settle();

    expect(server.requests.slice(watch.frame()!.requestsSoFar)).toEqual([]);
  });

  it("asks for each thing once — the calendar once, for the whole roster", async () => {
    renderWithClient(<SchedulePage />);
    await vi.waitFor(() => expect(gridIsUp()).toBe(true), { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
    const calendar = server.requests.filter((r) => r.includes("/calendar-events"));
    expect(calendar).toHaveLength(1);
    expect(decodeURIComponent(calendar[0])).toContain("techIds=t1,t2,t3");
  });

  it("never says 'No access' while the permissions are still on their way", async () => {
    perms.loading = true;
    renderWithClient(<SchedulePage />);
    await settle(100);

    expect(screen.queryByText(/no access/i)).not.toBeInTheDocument();
  });

  it("keeps the day on screen until the next one is in, then turns it over once", async () => {
    renderWithClient(<SchedulePage />);
    await screen.findByRole("button", { name: "Job ID: 801" }, { timeout: 3000 });
    await settle();

    let emptied = false;
    let unnamed = false;
    const observer = new MutationObserver(() => {
      if (!gridIsUp()) emptied = true;
      const next = jobText("802");
      if (next && !/Sam Reyes/.test(next)) unnamed = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // The old day stays until the new one is complete.
    expect(screen.getByRole("button", { name: "Job ID: 801" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "Job ID: 802" }, { timeout: 2000 });
    observer.disconnect();

    expect(emptied).toBe(false);
    expect(unnamed).toBe(false);
    expect(screen.queryByRole("button", { name: "Job ID: 801" })).not.toBeInTheDocument();
  });

  it("a request that fails does not hold the grid off the screen", async () => {
    server.fail(/\/calendar-events$/);
    renderWithClient(<SchedulePage />);

    await vi.waitFor(() => expect(gridIsUp()).toBe(true), { timeout: 3000 });
  });
});
