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
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Map: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  // forwardRef so React actually invokes the pin's ref callback (attach with a
  // node, detach with null) the way it does in the browser. An unstable ref
  // callback then loops here — "Maximum update depth exceeded" — which is the
  // clusterer bug this guards against; a stable one attaches once and passes.
  AdvancedMarker: forwardRef<HTMLDivElement, { children?: ReactNode }>(
    function AdvancedMarker({ children }, ref) {
      return <div ref={ref}>{children}</div>;
    },
  ),
  useMap: () => null,
}));

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
  jobType: "lockout",
  stage: "new_lead",
  assignedDispatcherId: "d1",
  priority: "normal",
  tags: [],
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
});
