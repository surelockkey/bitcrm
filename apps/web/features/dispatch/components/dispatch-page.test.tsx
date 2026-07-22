import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { DispatchPage } from "./dispatch-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
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
  // The roster reverse-geocodes via this; null → it simply shows no address.
  useMapsLibrary: () => null,
}));

// With a non-null map, the clusterer would build a real instance from our fake.
vi.mock("@googlemaps/markerclusterer", () => ({
  MarkerClusterer: class {
    clearMarkers() {}
    addMarkers() {}
  },
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
  usePermissions: () => permissions.value,
}));

const LOCATED = {
  id: "deal-1",
  dealNumber: 101,
  contactId: "contact-1",
  clientType: "residential",
  serviceArea: "Atlanta Metro",
  address: { street: "1 Peachtree St", city: "Atlanta", state: "GA", zip: "30303", lat: 33.749, lng: -84.388 },
  jobTypeId: "jt-lockout",
  stage: "new_lead",
  assignedDispatcherId: "d1",
  priority: "normal",
  tagIds: [],
  status: "active",
  createdBy: "d1",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
};

const UNLOCATED = {
  ...LOCATED,
  id: "deal-2",
  dealNumber: 102,
  address: { street: "9 Unknown Way", city: "Atlanta", state: "GA", zip: "30303" },
};

function mockApi() {
  server.use(
    http.get("*/deals", () =>
      HttpResponse.json({
        success: true,
        data: [LOCATED, UNLOCATED],
        pagination: { count: 2 },
      }),
    ),
    http.get("*/contacts", () =>
      HttpResponse.json({
        success: true,
        data: [{ id: "contact-1", firstName: "Ada", lastName: "Lovelace", phones: [], emails: [] }],
        pagination: { count: 1 },
      }),
    ),
    http.get("*/users", () =>
      HttpResponse.json({ success: true, data: [], pagination: { count: 0 } }),
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
  mockApi();
});

describe("DispatchPage", () => {
  it("lists the day's jobs", async () => {
    render(<DispatchPage />, { wrapper });

    expect(await screen.findByTestId("job-row-deal-1")).toBeInTheDocument();
    expect(screen.getByTestId("job-row-deal-2")).toBeInTheDocument();
  });

  it("marks the matching pin when a list row is hovered", async () => {
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });

    const row = await screen.findByTestId("job-row-deal-1");
    expect(screen.getByTestId("job-pin-deal-1")).toHaveAttribute("data-hovered", "false");

    await user.hover(row);

    await waitFor(() =>
      expect(screen.getByTestId("job-pin-deal-1")).toHaveAttribute("data-hovered", "true"),
    );
  });

  // A deal with no coordinates must be visible as a gap, not silently dropped.
  it("surfaces deals that cannot be placed on the map", async () => {
    render(<DispatchPage />, { wrapper });

    expect(await screen.findByText(/not on the map \(1\)/i)).toBeInTheDocument();
    // …and it is not given a pin.
    expect(screen.queryByTestId("job-pin-deal-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("job-pin-deal-1")).toBeInTheDocument();
  });

  it("opens the job details when a row is clicked", async () => {
    const user = userEvent.setup();
    render(<DispatchPage />, { wrapper });

    await user.click(await screen.findByTestId("job-row-deal-1"));

    expect(await screen.findByRole("button", { name: /close job details/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
  });

  it("refuses the page to someone without deals.view", async () => {
    permissions.value = { ...permissions.value, can: () => false };
    render(<DispatchPage />, { wrapper });

    expect(await screen.findByText(/no access/i)).toBeInTheDocument();
  });

  describe("layer toggle", () => {
    it("shows both jobs and technicians by default", async () => {
      render(<DispatchPage />, { wrapper });

      expect(await screen.findByTestId("job-pin-deal-1")).toBeInTheDocument();
      expect(await screen.findByTestId("tech-marker-tech-1")).toBeInTheDocument();
    });

    it("hides technician markers when 'Jobs' is picked", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("tech-marker-tech-1");

      await user.click(screen.getByRole("button", { name: /^jobs$/i }));

      expect(screen.getByTestId("job-pin-deal-1")).toBeInTheDocument();
      expect(screen.queryByTestId("tech-marker-tech-1")).not.toBeInTheDocument();
    });

    it("hides job pins when 'Techs' is picked", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-pin-deal-1");

      await user.click(screen.getByRole("button", { name: /^techs$/i }));

      expect(screen.getByTestId("tech-marker-tech-1")).toBeInTheDocument();
      expect(screen.queryByTestId("job-pin-deal-1")).not.toBeInTheDocument();
    });

    it("swaps the job list for the technician roster in 'Techs'", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-row-deal-1");

      await user.click(screen.getByRole("button", { name: /^techs$/i }));

      // Job rows gone, technician rows in their place.
      expect(screen.queryByTestId("job-row-deal-1")).not.toBeInTheDocument();
      expect(await screen.findByTestId("tech-row-tech-1")).toBeInTheDocument();
    });

    // "Both" shows the two lists together, not just the jobs.
    it("shows technicians and jobs together in 'Both'", async () => {
      render(<DispatchPage />, { wrapper });

      expect(await screen.findByTestId("job-row-deal-1")).toBeInTheDocument();
      expect(await screen.findByTestId("tech-row-tech-1")).toBeInTheDocument();
    });

    // No technician access → the toggle is meaningless and must not appear.
    it("does not render the toggle without technicians.view", async () => {
      permissions.value = {
        ...permissions.value,
        can: (resource: string) => resource !== "technicians",
      };
      render(<DispatchPage />, { wrapper });
      await screen.findByTestId("job-pin-deal-1");

      expect(screen.queryByRole("button", { name: /^techs$/i })).not.toBeInTheDocument();
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

      await user.click(await screen.findByRole("button", { name: /^techs$/i }));
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

      await user.click(await screen.findByRole("button", { name: /^techs$/i }));
      const row = await screen.findByTestId("tech-row-tech-1");

      await user.click(row);
      await waitFor(() => expect(fakeMap.panTo).toHaveBeenCalledTimes(1));
      await user.click(row);

      await waitFor(() => expect(fakeMap.panTo).toHaveBeenCalledTimes(2));
    });

    // Bug: a technician stayed selected after switching to Jobs.
    it("clears the selection when the layer changes", async () => {
      const user = userEvent.setup();
      render(<DispatchPage />, { wrapper });

      await user.click(await screen.findByRole("button", { name: /^techs$/i }));
      await user.click(await screen.findByTestId("tech-row-tech-1"));
      await waitFor(() => expect(fakeMap.panTo).toHaveBeenCalled());

      await user.click(screen.getByRole("button", { name: /^jobs$/i }));

      // Back to jobs: the job row is not marked selected (no lingering pick).
      const jobRow = await screen.findByTestId("job-row-deal-1");
      expect(jobRow).toHaveAttribute("data-hovered", "false");
    });
  });
});
