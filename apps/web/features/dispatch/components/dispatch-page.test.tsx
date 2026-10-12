import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { ctToday } from "@/lib/timezone";
import { DispatchPage } from "./dispatch-page";
import { mapRangeWindow } from "../map-range";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: router.push, prefetch: vi.fn() }),
}));

/**
 * Google Maps cannot render in jsdom, so the map is stubbed at the import
 * boundary. The pins still mount, which is what the hover wiring is about — the
 * map logic itself lives in pure functions and is covered by lib.test.ts.
 */
// A fake map so PanTo/FitToJobs can run — panTo is spied on to assert centring.
const fakeMap = vi.hoisted(() => ({
  panTo: vi.fn(),
  fitBounds: vi.fn(),
  setZoom: vi.fn(),
  getZoom: vi.fn(() => 11),
}));

vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Map: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  // forwardRef so React actually invokes each pin's ref callback — attach with a
  // node, detach with null — the way it does in the browser. An unstable ref
  // callback then loops here ("Maximum update depth exceeded"); a stable one
  // attaches once. This is what makes the whole suite a guard against the
  // clusterer regression.
  AdvancedMarker: forwardRef<HTMLDivElement, { children?: ReactNode }>(
    function AdvancedMarker({ children }, ref) {
      return <div ref={ref}>{children}</div>;
    },
  ),
  useMap: () => fakeMap,
  // The roster reverse-geocodes via these. Maps cannot load in jsdom: a failed
  // load means no streets, and nothing for the board to wait on.
  useMapsLibrary: () => null,
  useApiLoadingStatus: () => "FAILED",
}));

// The edit sheet's own form (catalog selects, custom fields) is not this page's
// concern; what it is handed is — the whole job, not the map's cut-down row.
vi.mock("@/features/deals/components/edit-deal-sheet", () => ({
  EditDealSheet: ({ deal }: { deal: { dealNumber: string; notes?: string } }) => (
    <div role="dialog" aria-label={`Edit Job #${deal.dealNumber}`}>
      {deal.notes ?? "(no notes)"}
    </div>
  ),
}));

// FitToJobs builds a LatLngBounds; stub the tiny slice it touches.
vi.stubGlobal("google", {
  maps: {
    LatLngBounds: class {
      extend() {}
    },
  },
});

// The page deliberately renders an explanation instead of a map when the key or
// the vector Map ID is missing; give it both so the pins mount.
vi.mock("@/lib/env", () => ({
  env: {
    apiBaseUrl: "http://api.test",
    googleMapsApiKey: "test-key",
    googleMapsMapId: "test-map-id",
  },
}));

const permissions = vi.hoisted(() => ({
  value: {
    can: (_r: string, _a: string): boolean => true,
    scopeOf: () => "all",
    isTechnician: false,
    roleName: "Admin",
    me: undefined,
  },
}));
vi.mock("@/features/auth/use-permissions", () => ({
  // The permissions are in: a refusal is whatever `can` says.
  useDenied: () => (resource: string, action = "view") => !permissions.value.can(resource, action),
  usePermissions: () => permissions.value,
}));

/** Today as the page reads it — Connecticut's calendar day (2026-10-12 owner rule). */
function localDay(offset = 0): string {
  const d = new Date(`${ctToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const LOCATED = {
  id: "deal-1",
  dealNumber: "101",
  contactId: "contact-1",
  clientType: "residential",
  serviceArea: "Atlanta Metro",
  address: { street: "1 Peachtree St", city: "Atlanta", state: "GA", zip: "30303", lat: 33.749, lng: -84.388 },
  jobTypeId: "jt-lockout",
  stage: "new_lead",
  superStatus: "submitted",
  scheduledDate: localDay(),
  scheduledTimeSlot: "07:30-08:30",
  assignedDispatcherId: "d1",
  priority: "normal",
  assignedTechIds: [],
  tagIds: [],
  status: "active",
  createdBy: "d1",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

const UNLOCATED = {
  ...LOCATED,
  id: "deal-2",
  dealNumber: "102",
  address: { street: "9 Unknown Way", city: "Atlanta", state: "GA", zip: "30303" },
};

/** On tech-1, three weeks out — outside the week the Map opens on. */
const LATER = {
  ...LOCATED,
  id: "deal-3",
  dealNumber: "103",
  superStatus: "in_progress",
  scheduledDate: localDay(21),
  assignedTechIds: ["tech-1"],
  address: { ...LOCATED.address, lat: 33.8, lng: -84.3 },
};

/** The clients and techs `GET /deals/map` names beside its jobs. */
const INCLUDED = {
  technicians: [{ id: "tech-1", firstName: "Daniel", lastName: "Munoz", workizName: "(2) TX - Daniel Munoz" }],
  clients: [{ id: "contact-1", firstName: "Ada", lastName: "Lovelace", phones: ["+14045550101"], emails: [] }],
};

/** `GET /deals/map`'s answer: the jobs, their count, who they name. */
const mapReply = (data: unknown[]) =>
  HttpResponse.json({ success: true, data, pagination: { count: data.length }, included: INCLUDED });

function mockApi() {
  server.use(
    // The board's one read: every open job, with its clients and techs.
    http.get("*/deals/map", () => mapReply([LOCATED, UNLOCATED, LATER])),
    http.get("*/deals/job-types", () =>
      HttpResponse.json({ success: true, data: [{ id: "jt-lockout", name: "Lockout", active: true, priority: 1 }] }),
    ),
    http.get("*/deals/service-areas", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/users", () =>
      HttpResponse.json({
        success: true,
        data: [{ id: "tech-1", firstName: "Daniel", lastName: "Munoz", workizName: "(2) TX - Daniel Munoz" }],
        pagination: { count: 1 },
      }),
    ),
    http.get("*/users/technicians/locations", () =>
      HttpResponse.json({ success: true, data: [] }),
    ),
    http.get("*/users/technicians", () =>
      HttpResponse.json({
        success: true,
        data: [
          {
            userId: "tech-1",
            status: "active",
            callMaskingEnabled: false,
            gpsTrackingEnabled: false,
            mobileAppInstalled: false,
            homeAddress: { line1: "9 Home Rd", city: "Atlanta", state: "GA", zip: "30310", lat: 33.7, lng: -84.4 },
          },
        ],
        pagination: { count: 1 },
      }),
    ),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  permissions.value = {
    can: () => true,
    scopeOf: () => "all",
    isTechnician: false,
    roleName: "Admin",
    me: undefined,
  };
  fakeMap.panTo.mockClear();
  router.push.mockClear();
  window.sessionStorage.clear();
  mockApi();
});

describe("DispatchPage — Workiz's Map", () => {
  it("lists the week's jobs as Workiz job cards: type - Job #, address, status", async () => {
    render(<DispatchPage />, { wrapper });

    const card = await screen.findByTestId("job-row-deal-1");
    expect(card).toHaveTextContent("Lockout - Job #101");
    expect(card).toHaveTextContent("1 Peachtree St, Atlanta, Georgia, 30303");
    expect(card).toHaveTextContent("Submitted");
    expect(screen.getByTestId("job-row-deal-2")).toBeInTheDocument();
  });

  it("reads every open job once, whatever the date — never the closed ones", async () => {
    const urls: string[] = [];
    server.use(
      http.get("*/deals/map", ({ request }) => {
        urls.push(request.url);
        return mapReply([LOCATED, UNLOCATED]);
      }),
    );
    render(<DispatchPage />, { wrapper });
    await screen.findByTestId("job-row-deal-1");
    // One request; no statuses and no days — deal-service's default is every open job.
    expect(urls).toHaveLength(1);
    expect([...new URL(urls[0]).searchParams.keys()]).toEqual([]);
  });

  it("shows the chosen week and says how many of the open jobs that is", async () => {
    render(<DispatchPage />, { wrapper });

    expect(await screen.findByText("Found 2 out of 3 open jobs")).toBeInTheDocument();
    expect(screen.queryByTestId("job-row-deal-3")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /range/i })).toHaveTextContent("Week");
  });

  // Ours, kept from before the Workiz pass: every open job at once, whatever its date.
  it("Any date shows every open job — unscheduled and weeks-away ones too — and has nothing to step", async () => {
    const UNSCHEDULED = { ...LOCATED, id: "deal-4", dealNumber: "104", scheduledDate: undefined, scheduledTimeSlot: undefined };
    server.use(http.get("*/deals/map", () => mapReply([LOCATED, UNLOCATED, LATER, UNSCHEDULED])));
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });
    await screen.findByTestId("job-row-deal-1");
    expect(screen.queryByTestId("job-row-deal-4")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /range/i }));
    await user.click(await screen.findByRole("option", { name: "Any date" }));

    expect(await screen.findByTestId("job-row-deal-4")).toBeInTheDocument();
    expect(screen.getByTestId("job-row-deal-3")).toBeInTheDocument();
    expect(screen.getByText("Found 4 out of 4 open jobs")).toBeInTheDocument();
    expect(screen.getByText("All open jobs, any date")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
  });

  // 2026-10-12 owner rule: the web's day and clock are Connecticut's.
  it("opens the date box on Connecticut's week, whatever the browser's clock says, and labels Last updated", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Sat Oct 17, 10:30 PM EDT — already Sunday, a new week, in Kyiv and in UTC.
    vi.setSystemTime(new Date("2026-10-18T02:30:00Z"));
    try {
      render(<DispatchPage />, { wrapper });
      expect(await screen.findByText(/Sun, Oct 11, 2026/)).toBeInTheDocument();
      expect(screen.getByText("Sat, Oct 17, 2026")).toBeInTheDocument();
      expect(screen.getByTitle(/^Last updated/)).toHaveAttribute("title", "Last updated 10:30:00 PM EDT");
    } finally {
      vi.useRealTimers();
    }
  });

  it("› steps a week on; Reset date comes back to today", async () => {
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });
    await screen.findByTestId("job-row-deal-1");

    for (let i = 0; i < 3; i++) await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByTestId("job-row-deal-3")).toBeInTheDocument();
    expect(screen.queryByTestId("job-row-deal-1")).not.toBeInTheDocument();
    expect(screen.getByText("Found 1 out of 3 open jobs")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset date" }));
    expect(await screen.findByTestId("job-row-deal-1")).toBeInTheDocument();
  });

  it("shows a pin's tech in a tooltip while its card in the list is hovered", async () => {
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });

    const row = await screen.findByTestId("job-row-deal-1");
    expect(screen.getByTestId("job-pin-deal-1")).toHaveAttribute("data-hovered", "false");

    await user.hover(row);

    await waitFor(() =>
      expect(screen.getByTestId("job-pin-deal-1")).toHaveAttribute("data-hovered", "true"),
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("Unassigned");
  });

  // A deal with no coordinates must be visible as a gap, not silently dropped.
  it("surfaces jobs that cannot be placed on the map", async () => {
    render(<DispatchPage />, { wrapper });

    expect(await screen.findByText(/not on the map \(1\)/i)).toBeInTheDocument();
    // …and it is not given a pin.
    expect(screen.queryByTestId("job-pin-deal-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("job-pin-deal-1")).toBeInTheDocument();
  });

  it("opens the job's card over its pin when its row is clicked", async () => {
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });

    await user.click(await screen.findByTestId("job-row-deal-1"));

    const card = await screen.findByRole("dialog", { name: "Lockout - Job #101" });
    expect(card).toHaveTextContent("Ada Lovelace");
    expect(card).toHaveTextContent("(404) 555-0101");
    expect(card).toHaveTextContent("1 Peachtree St, Atlanta, Georgia, 30303");
    expect(card).toHaveTextContent("Unassigned");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View" }));
    expect(router.push).toHaveBeenCalledWith("/deals/deal-1");

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Lockout - Job #101" })).not.toBeInTheDocument();
  });

  // Ours: the job's place in its tech's day, as Workiz's appointment badge.
  it("shows the job's place in its tech's day on the card", async () => {
    server.use(
      http.get("*/deals/map", () => mapReply([{ ...LOCATED, assignedTechIds: ["tech-1"], sequences: { "tech-1": 2 } }])),
    );
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });

    await user.click(await screen.findByTestId("job-row-deal-1"));
    const card = await screen.findByRole("dialog", { name: "Lockout - Job #101" });
    expect(card).toHaveTextContent("(2) TX - Daniel Munoz");
    expect(screen.getByTitle("Stop 2 of the tech's day")).toHaveTextContent("2");
  });

  // The map's rows are cut to what the map draws (no notes, no money, no custom
  // answers): editing one as it is would save those blank. Edit opens on the
  // whole job, read by id.
  it("Edit opens the sheet on the whole job, read by id — never on the map's cut-down row", async () => {
    const urls: string[] = [];
    server.use(
      http.get("*/deals/deal-1", ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ success: true, data: { ...LOCATED, notes: "Gate code 1234" } });
      }),
    );
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });

    await user.click(await screen.findByTestId("job-row-deal-1"));
    await user.click(await screen.findByRole("button", { name: "Edit" }));

    expect(await screen.findByRole("dialog", { name: "Edit Job #101" })).toHaveTextContent("Gate code 1234");
    expect(urls).toHaveLength(1);
  });

  // A dispatcher who may not list users still reads the techs' names on the
  // pins and cards: they come with the jobs (`included.technicians`).
  it("names the techs from the map's own answer when the viewer cannot list users", async () => {
    permissions.value = { ...permissions.value, can: (r: string) => r !== "users" };
    server.use(
      http.get("*/deals/map", () => mapReply([{ ...LOCATED, assignedTechIds: ["tech-1"] }])),
      http.get("*/users", () => HttpResponse.json({ success: false }, { status: 403 })),
    );
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });

    await user.click(await screen.findByTestId("job-row-deal-1"));
    const card = await screen.findByRole("dialog", { name: "Lockout - Job #101" });
    expect(card).toHaveTextContent("(2) TX - Daniel Munoz");
  });

  it("offers no Edit or Assign without deals.edit", async () => {
    permissions.value = { ...permissions.value, can: (_r: string, a: string) => a !== "edit" };
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });

    await user.click(await screen.findByTestId("job-row-deal-1"));
    await screen.findByRole("dialog", { name: "Lockout - Job #101" });
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign" })).not.toBeInTheDocument();
  });

  it("refuses the page to someone without deals.view", async () => {
    permissions.value = { ...permissions.value, can: () => false };
    render(<DispatchPage />, { wrapper });

    expect(await screen.findByText(/no access/i)).toBeInTheDocument();
  });

  describe("Filters", () => {
    it("narrows the jobs to the ticked statuses once applied", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-row-deal-1");

      await user.click(screen.getByRole("button", { name: "Filter by" }));
      expect(screen.getByText("Technician")).toBeInTheDocument();
      expect(screen.getByText("Service Area")).toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: "In progress" }));
      await user.click(screen.getByRole("button", { name: "Apply" }));

      expect(await screen.findByText("Found 0 out of 3 open jobs")).toBeInTheDocument();
      expect(screen.queryByTestId("job-row-deal-1")).not.toBeInTheDocument();
    });

    it("Technician 'Unassigned' keeps the jobs nobody is on", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-row-deal-1");

      await user.click(screen.getByRole("button", { name: "Filter by" }));
      await user.click(screen.getByRole("checkbox", { name: "(2) TX - Daniel Munoz" }));
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(await screen.findByText("Found 0 out of 3 open jobs")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Filter by" }));
      await user.click(screen.getByRole("button", { name: "Clear" }));
      await user.click(screen.getByRole("checkbox", { name: "Unassigned" }));
      await user.click(screen.getByRole("button", { name: "Apply" }));
      expect(await screen.findByText("Found 2 out of 3 open jobs")).toBeInTheDocument();
    });

    // Ours, kept from before the Workiz pass: the day's or week's finished jobs.
    it("Done / Canceled, once ticked, are read for the date box's days and shown", async () => {
      const DONE = { ...LOCATED, id: "deal-9", dealNumber: "109", superStatus: "done", stage: "done" };
      const urls: string[] = [];
      server.use(
        http.get("*/deals/map", ({ request }) => {
          urls.push(request.url);
          const statuses = new URL(request.url).searchParams.get("statuses");
          return mapReply(statuses === "done" ? [DONE] : [LOCATED, UNLOCATED, LATER]);
        }),
      );
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-row-deal-1");
      expect(urls.some((u) => new URL(u).searchParams.has("statuses"))).toBe(false);

      await user.click(screen.getByRole("button", { name: "Filter by" }));
      expect(screen.getByRole("checkbox", { name: "Canceled" })).toBeInTheDocument();
      await user.click(screen.getByRole("checkbox", { name: "Done" }));
      await user.click(screen.getByRole("button", { name: "Apply" }));

      expect(await screen.findByTestId("job-row-deal-9")).toHaveTextContent("Done");
      expect(screen.queryByTestId("job-row-deal-1")).not.toBeInTheDocument();
      expect(screen.getByText("Found 1 out of 4 jobs")).toBeInTheDocument();
      const week = mapRangeWindow("week", localDay());
      const done = urls.map((u) => new URL(u).searchParams).find((p) => p.get("statuses") === "done");
      expect(done?.get("from")).toBe(week.from);
      expect(done?.get("to")).toBe(week.to);
    });

    it("‹ leaves the panel without applying", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-row-deal-1");

      await user.click(screen.getByRole("button", { name: "Filter by" }));
      await user.click(screen.getByRole("checkbox", { name: "Pending" }));
      await user.click(screen.getByRole("button", { name: "Back" }));

      expect(await screen.findByText("Found 2 out of 3 open jobs")).toBeInTheDocument();
    });
  });

  describe("Jobs | Techs", () => {
    it("the Jobs tab draws job pins only, unless 'Show techs' is on", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });

      expect(await screen.findByTestId("job-pin-deal-1")).toBeInTheDocument();
      expect(screen.queryByTestId("tech-marker-tech-1")).not.toBeInTheDocument();

      await user.click(screen.getByRole("switch", { name: "Show techs" }));
      expect(await screen.findByTestId("tech-marker-tech-1")).toBeInTheDocument();
    });

    it("the Techs tab lists the team, draws their pins and drops the jobs and the date box", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-row-deal-1");

      await user.click(screen.getByRole("tab", { name: "Techs" }));

      expect(await screen.findByTestId("tech-row-tech-1")).toHaveTextContent("(2) TX - Daniel Munoz");
      expect(screen.getByText("Found 1 users")).toBeInTheDocument();
      expect(screen.getByTestId("tech-marker-tech-1")).toBeInTheDocument();
      expect(screen.queryByTestId("job-row-deal-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("job-pin-deal-1")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Filter by" })).not.toBeInTheDocument();
    });

    it("a tech's card shows where they are and their day", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-row-deal-1");

      await user.click(screen.getByRole("tab", { name: "Techs" }));
      await user.click(await screen.findByTestId("tech-row-tech-1"));

      const card = await screen.findByRole("dialog", { name: "(2) TX - Daniel Munoz" });
      expect(card).toHaveTextContent(/home address/i);
      expect(card).toHaveTextContent(/today's jobs/i);
    });

    // No technician access → neither the tabs nor the toggle mean anything.
    it("shows no tabs and no 'Show techs' without technicians.view", async () => {
      permissions.value = {
        ...permissions.value,
        can: (resource: string) => resource !== "technicians",
      };
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-pin-deal-1");

      expect(screen.queryByRole("tab", { name: "Techs" })).not.toBeInTheDocument();
      expect(screen.queryByRole("switch", { name: "Show techs" })).not.toBeInTheDocument();
    });
  });

  describe("centres the map on a selection", () => {
    it("pans to a job when its row is clicked", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });

      await user.click(await screen.findByTestId("job-row-deal-1"));

      await waitFor(() =>
        expect(fakeMap.panTo).toHaveBeenCalledWith({ lat: 33.749, lng: -84.388 }),
      );
    });

    it("pans to a technician when their row is clicked", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });

      await user.click(await screen.findByRole("tab", { name: "Techs" }));
      await user.click(await screen.findByTestId("tech-row-tech-1"));

      // The mocked technician's derived (home) position.
      await waitFor(() =>
        expect(fakeMap.panTo).toHaveBeenCalledWith({ lat: 33.7, lng: -84.4 }),
      );
    });

    // Bug: re-picking the same technician (or one already selected) stopped
    // panning because only a coordinate change re-fired the effect.
    it("re-centres when the same technician is picked twice", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });

      await user.click(await screen.findByRole("tab", { name: "Techs" }));
      const row = await screen.findByTestId("tech-row-tech-1");

      await user.click(row);
      await waitFor(() => expect(fakeMap.panTo).toHaveBeenCalledTimes(1));
      await user.click(row);

      await waitFor(() => expect(fakeMap.panTo).toHaveBeenCalledTimes(2));
    });

    // Bug: a technician stayed selected after switching back to Jobs.
    it("clears the selection when the tab changes", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });

      await user.click(await screen.findByRole("tab", { name: "Techs" }));
      await user.click(await screen.findByTestId("tech-row-tech-1"));
      await screen.findByRole("dialog", { name: "(2) TX - Daniel Munoz" });

      await user.click(screen.getByRole("tab", { name: "Jobs" }));

      await screen.findByTestId("job-row-deal-1");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
