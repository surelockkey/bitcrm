import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";
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
 * The dispatch board appears once, whole — and stays put.
 *
 * It used to arrive in waves: the toolbar over a spinner, then the jobs with
 * "Unknown client" on every row, then the names, then the technicians — named
 * "Technician" until the directory came, sorted again once their live GPS
 * did — and last the street address under each of them, looked up one by one
 * from Google, every new line pushing the rows below it down. The dispatcher
 * watched the roster reshuffle for four seconds.
 *
 * This renders the real board against a fake server (and a fake geocoder)
 * and looks at the very first frame it shows: everything on it must already
 * be in, in its final order, and nothing more may be asked for afterwards.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));

// Google Maps cannot render in jsdom: the map is a div, the pins mount, and
// the geocoder answers each lookup after a beat with an invented street.
const geocoder = vi.hoisted(() => ({ lookups: 0, delayMs: 30 }));
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Map: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  AdvancedMarker: forwardRef<HTMLDivElement, { children?: ReactNode }>(function AdvancedMarker({ children }, ref) {
    return <div ref={ref}>{children}</div>;
  }),
  useMap: () => ({ panTo: () => {}, fitBounds: () => {}, setZoom: () => {}, getZoom: () => 11 }),
  useApiLoadingStatus: () => "LOADED",
  useMapsLibrary: (name: string) =>
    name === "geocoding"
      ? {
          Geocoder: class {
            geocode({ location }: { location: { lat: number; lng: number } }) {
              geocoder.lookups += 1;
              return new Promise((resolve) =>
                setTimeout(
                  () => resolve({ results: [{ formatted_address: `${location.lat.toFixed(2)} Test Way` }] }),
                  geocoder.delayMs,
                ),
              );
            }
          },
        }
      : null,
}));
vi.mock("@/lib/env", () => ({
  env: { apiBaseUrl: "http://api.test", googleMapsApiKey: "test-key", googleMapsMapId: "test-map-id" },
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

/** The viewer's day — the Map opens on the week around it. */
const localDay = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

const deal = (n: number, over: Partial<Deal> = {}): Deal => ({
  id: `d${n}`,
  dealNumber: `70${n}`,
  contactId: `c${n}`,
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "North",
  address: { street: `${n} Elm St`, city: "Testville", state: "GA", zip: "30001", lat: 33.7 + n / 100, lng: -84.4 },
  jobTypeId: "jt-lockout",
  superStatus: JobSuperStatus.SUBMITTED,
  scheduledDate: localDay,
  assignedDispatcherId: "u-disp",
  priority: DealPriority.NORMAL,
  assignedTechIds: [],
  tagIds: [],
  status: DealStatus.ACTIVE,
  createdBy: "u-disp",
  createdAt: "",
  updatedAt: "",
  ...over,
});

const contacts = [
  { id: "c1", firstName: "Ivy", lastName: "Quill", phones: [], emails: [], addresses: [] },
  { id: "c2", firstName: "Otto", lastName: "Brisk", phones: [], emails: [], addresses: [] },
  { id: "c3", firstName: "Pia", lastName: "Lark", phones: [], emails: [], addresses: [] },
];

/** Technicians: one placed by a fresh live fix, one by home, one by nothing. */
const profiles = [
  { userId: "t-home", status: "active", homeAddress: { line1: "1 Home Rd", city: "Testville", state: "GA", zip: "30001", lat: 33.61, lng: -84.31 } },
  { userId: "t-live", status: "active" },
  { userId: "t-off", status: "active" },
];
const users = [
  { id: "t-home", firstName: "Hana", lastName: "Home", email: "hana@example.test" },
  { id: "t-live", firstName: "Lev", lastName: "Live", email: "lev@example.test" },
  { id: "t-off", firstName: "Ola", lastName: "Off", email: "ola@example.test" },
];

const inProgress = () =>
  deal(3, { superStatus: JobSuperStatus.IN_PROGRESS, scheduledDate: localDay, assignedTechIds: ["t-home"] });

/** `GET /deals/map`: every open job at once, with the names they refer to. */
const mapRoute: FakeRoute = {
  match: /\/deals\/map$/,
  raw: true,
  reply: () => ({
    success: true,
    data: [deal(1), deal(2), inProgress()],
    pagination: { count: 3 },
    included: {
      technicians: [{ id: "t-home", firstName: "Hana", lastName: "Home" }],
      clients: contacts.map(({ id, firstName, lastName }) => ({ id, firstName, lastName, phones: [], emails: [] })),
    },
  }),
  delayMs: 40,
};

/** The deals list, per status — `submitted` drains over two pages, as a big board does. */
function dealsReply(url: URL) {
  const status = url.searchParams.get("superStatus");
  const cursor = url.searchParams.get("cursor");
  const page = (data: Deal[], nextCursor?: string) => ({ success: true, data, pagination: { nextCursor } });
  if (status === "submitted") return cursor ? page([deal(2)]) : page([deal(1)], "next");
  if (status === "in_progress") return page([inProgress()]);
  return page([]);
}

/** A deal-service from before `/deals/map`: `GET /deals/:id` answers it, and the board drains the list instead. */
const oldApiRoutes: FakeRoute[] = [
  {
    match: /\/deals\/map$/,
    raw: true,
    status: 404,
    reply: () => ({ success: false, error: { code: "NOT_FOUND", message: "Deal map not found" } }),
    delayMs: 20,
  },
  // The second page of a drain is slow — it is what kept the board waiting.
  { match: /\/deals$/, raw: true, reply: dealsReply, delayMs: 40 },
  { match: /\/crm\/contacts\/by-ids$/, method: "POST", reply: () => contacts, delayMs: 30 },
];

const routes: FakeRoute[] = [
  mapRoute,
  {
    match: /\/users$/,
    raw: true,
    // The directory drains too: one name per page.
    reply: (url) => {
      const i = Number(url.searchParams.get("cursor") ?? 0);
      return { success: true, data: [users[i]], pagination: { nextCursor: i + 1 < users.length ? String(i + 1) : undefined } };
    },
    delayMs: 25,
  },
  { match: /\/users\/technicians$/, raw: true, reply: () => ({ success: true, data: profiles, pagination: {} }), delayMs: 30 },
  {
    match: /\/users\/technicians\/locations$/,
    reply: () => [{ userId: "t-live", lat: 33.52, lng: -84.22, accuracy: 10, updatedAt: new Date().toISOString() }],
    delayMs: 60,
  },
  { match: /\/deals\/service-areas$/, reply: () => [], delayMs: 20 },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true, priority: 1 }], delayMs: 50 },
];

let server: FakeServer;

/** The board is up: the Map's sidebar and map are on screen. */
const boardIsUp = () => !!document.querySelector('[data-testid="dispatch-board"]');
const boardUp = (timeout = 3000) => screen.findByTestId("dispatch-board", {}, { timeout });

const techRowOrder = () =>
  Array.from(document.querySelectorAll('[data-testid^="tech-row-"]')).map((el) =>
    el.getAttribute("data-testid")!.replace("tech-row-", ""),
  );

/** What a dispatcher sees on the Techs tab the moment it opens. */
const rosterFrame = () => ({
  techNames: ["Hana Home", "Lev Live", "Ola Off"].every((n) => screen.queryAllByText(n).length > 0),
  liveStatus: screen.queryAllByText(/Online · just now/).length > 0,
  techAddresses: screen.queryAllByText(/Test Way/).length,
  techOrder: techRowOrder(),
});

function watchBoardFirstFrame() {
  return watchFirstFrame(boardIsUp, () => ({
    requestsSoFar: server.requests.length,
    jobRows: document.querySelectorAll('[data-testid^="job-row-"]').length,
    jobTitles: ["Lockout - Job #701", "Lockout - Job #702", "Lockout - Job #703"].every(
      (t) => screen.queryAllByText(t).length > 0,
    ),
    unknownClient: screen.queryAllByText("Unknown client").length,
    unknownType: screen.queryAllByText(/Unknown type/).length,
    jobCount: !!screen.queryByText("Found 3 out of 3 open jobs"),
    skeletons: skeletonCount(),
  }));
}

const { DispatchPage } = await import("./dispatch-page");

beforeEach(() => {
  perms.loading = false;
  geocoder.lookups = 0;
  geocoder.delayMs = 30;
  window.sessionStorage.clear();
  server = installFakeServer(routes);
  // FitTo builds a LatLngBounds; stub the slice it touches.
  vi.stubGlobal("google", { maps: { LatLngBounds: class { extend() {} } } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DispatchPage — one load, not waves", () => {
  it("shows the board only once everything on it has arrived", async () => {
    const watch = watchBoardFirstFrame();
    renderWithClient(<DispatchPage />);
    await boardUp();
    watch.stop();

    expect(watch.frame()).toMatchObject({
      jobRows: 3,
      jobTitles: true,
      unknownClient: 0,
      unknownType: 0,
      jobCount: true,
      skeletons: 0,
    });
  });

  // app_audit 2026-10-09 (finding 6): 10–15 s of a bare spinner before
  // anything drew. The wait is the board's — every open job, their clients,
  // the team — but what the dispatcher looks at meanwhile must be the page's
  // own shape: the sidebar with its search, tabs and card places, and the
  // map's frame with the date box, grey where the words will be.
  it("holds the board's own shape while it waits — the sidebar and the map's frame, never a bare spinner", async () => {
    renderWithClient(<DispatchPage />);

    const shape = screen.getByTestId("dispatch-board-skeleton");
    expect(shape).toBeInTheDocument();
    expect(skeletonCount(shape)).toBeGreaterThan(3);
    expect(document.querySelector(".animate-spin")).toBeNull();
    // The sidebar's width and the map beside it, as on the board.
    expect(shape.querySelector('[data-testid="map-sidebar-skeleton"]')?.className).toContain("w-[386px]");
    expect(shape.querySelector('[data-testid="map-skeleton"]')).toBeInTheDocument();

    await boardUp();
    expect(screen.queryByTestId("dispatch-board-skeleton")).toBeNull();
  });

  it("asks for nothing more once the board is on screen", async () => {
    const watch = watchBoardFirstFrame();
    renderWithClient(<DispatchPage />);
    await boardUp();
    watch.stop();
    await settle();

    // Nothing new: only the rest of the team's directory, asked before the
    // board and still paging behind it (the Jobs tab names its techs from the
    // map's own answer, so it does not wait for that).
    const after = server.requests.slice(watch.frame()!.requestsSoFar);
    expect(after.filter((r) => !/^\/users\?(.*&)?cursor=/.test(r))).toEqual([]);
  });

  // 2026-10-12 (map_fast): 5–8 s on dev were the open jobs drained a hundred a
  // page — four statuses, each page after the last — and only then the clients
  // by id. Now one request answers both.
  it("reads the board's jobs in one request — no list pages, no clients by id", async () => {
    renderWithClient(<DispatchPage />);
    await boardUp();
    await settle();

    const jobs = server.requests.filter((r) => /^\/deals(\/map)?(\?|$)/.test(r));
    // The open jobs of the week the board opens on (deal-service reads only those days).
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatch(/^\/deals\/map\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    expect(server.requests.some((r) => r.startsWith("/crm/contacts/by-ids"))).toBe(false);
  });

  it("on a deal-service without /deals/map, drains the list the old way — still one whole board", async () => {
    server = installFakeServer([...oldApiRoutes, ...routes.slice(1)]);
    const watch = watchBoardFirstFrame();
    renderWithClient(<DispatchPage />);
    await boardUp();
    watch.stop();

    expect(watch.frame()).toMatchObject({ jobRows: 3, jobTitles: true, unknownClient: 0, jobCount: true, skeletons: 0 });
    expect(server.requests.some((r) => r.startsWith("/deals/map"))).toBe(true);
    expect(server.requests.some((r) => r.startsWith("/deals?") && r.includes("cursor=next"))).toBe(true);
    expect(server.requests).toContain("/crm/contacts/by-ids");
  });

  it("the Jobs tab is not held for the team's streets — no street is drawn on it", async () => {
    geocoder.delayMs = 1500;
    renderWithClient(<DispatchPage />);

    // Held, it would wait for Google's answer (or its 2 s cap).
    expect(await boardUp(1000)).toBeInTheDocument();
    expect(screen.getByTestId("job-row-d1")).toBeInTheDocument();
  });

  it("the Jobs tab is not held for the team when no tech is drawn on it", async () => {
    server = installFakeServer(
      routes.map((r) => (String(r.match) === String(/\/users\/technicians\/locations$/) ? { ...r, delayMs: 1500 } : r)),
    );
    renderWithClient(<DispatchPage />);

    expect(await boardUp(1000)).toBeInTheDocument();
  });

  it("with 'Show techs' on, the team is on the first frame of the Jobs tab", async () => {
    window.sessionStorage.setItem("dispatch:map", JSON.stringify({ showTechs: true }));
    const watch = watchFirstFrame(boardIsUp, () => ({
      techMarkers: document.querySelectorAll('[data-testid^="tech-marker-"]').length,
      jobRows: document.querySelectorAll('[data-testid^="job-row-"]').length,
    }));
    renderWithClient(<DispatchPage />);
    await boardUp();
    watch.stop();

    // t-home (its in-progress job today) and t-live (a fresh fix); t-off cannot be placed.
    expect(watch.frame()).toEqual({ techMarkers: 2, jobRows: 3 });
  });

  it("the Techs tab, opened before the team is in, holds its rows — then draws them whole, streets and all", async () => {
    geocoder.delayMs = 400;
    renderWithClient(<DispatchPage />);
    await boardUp();
    const watch = watchFirstFrame(
      () => document.querySelectorAll('[data-testid^="tech-row-"]').length > 0,
      () => rosterFrame(),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Techs" }));
    expect(screen.getByTestId("map-list-skeleton")).toBeInTheDocument();
    expect(techRowOrder()).toEqual([]);

    await screen.findByTestId("tech-row-t-live", {}, { timeout: 3000 });
    watch.stop();
    expect(watch.frame()).toMatchObject({ techNames: true, liveStatus: true, techAddresses: 2 });
    expect(screen.queryByTestId("map-list-skeleton")).toBeNull();
  });

  it("asks for each thing once", async () => {
    renderWithClient(<DispatchPage />);
    await boardUp();
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  it("has the whole team — names, live status, streets — the moment the Techs tab opens", async () => {
    renderWithClient(<DispatchPage />);
    await boardUp();
    await settle();
    const asked = server.requests.length;

    fireEvent.click(screen.getByRole("tab", { name: "Techs" }));

    expect(rosterFrame()).toMatchObject({ techNames: true, liveStatus: true, techAddresses: 2 });
    await settle();
    expect(server.requests.slice(asked)).toEqual([]);
  });

  it("does not reshuffle the technicians once they are on screen", async () => {
    renderWithClient(<DispatchPage />);
    await boardUp();
    const watch = watchFirstFrame(
      () => document.querySelectorAll('[data-testid^="tech-row-"]').length > 0,
      () => techRowOrder(),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Techs" }));
    await screen.findByTestId("tech-row-t-live");
    watch.stop();
    const first = watch.frame();
    await settle();

    // Online first, then by name — and that order is the first one drawn.
    expect(first).toEqual(["t-live", "t-home", "t-off"]);
    expect(techRowOrder()).toEqual(first);
  });

  it("looks up each technician's street once, all at once", async () => {
    renderWithClient(<DispatchPage />);
    await boardUp();
    await settle();

    expect(geocoder.lookups).toBe(2);
  });

  it("never says 'No access' while the permissions are still on their way", async () => {
    perms.loading = true;
    renderWithClient(<DispatchPage />);
    await settle(100);

    expect(screen.queryByText(/no access/i)).not.toBeInTheDocument();
  });

  it("filters among the jobs in hand: the Filters ask for nothing, the date box for its new days only", async () => {
    renderWithClient(<DispatchPage />);
    await boardUp();
    await settle();
    const asked = server.requests.length;

    fireEvent.click(screen.getByRole("button", { name: "Filter by" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "In progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    // At once: only the in-progress job, never an empty board in between.
    expect(screen.getByTestId("job-row-d3")).toBeInTheDocument();
    expect(screen.queryByTestId("job-row-d1")).not.toBeInTheDocument();

    expect(server.requests.slice(asked)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByTestId("job-row-d3")).not.toBeInTheDocument();
    await settle();

    // Next week's open jobs, once — the team is not drawn on the Jobs tab, so not today's beside them.
    const later = server.requests.slice(asked);
    expect(later).toHaveLength(1);
    expect(later[0]).toMatch(/^\/deals\/map\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  });

  it("a request that fails does not hold the board off the screen", async () => {
    server.fail(/\/users\/technicians\/locations$/);
    renderWithClient(<DispatchPage />);

    expect(await boardUp()).toBeInTheDocument();
  });

  it("a geocoder that never answers does not hold the board off the screen", async () => {
    geocoder.delayMs = 60_000;
    renderWithClient(<DispatchPage />);

    expect(await boardUp(5000)).toBeInTheDocument();
  });
});
