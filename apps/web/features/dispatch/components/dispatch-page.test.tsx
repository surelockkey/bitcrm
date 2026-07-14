import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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
  AdvancedMarker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useMap: () => null,
}));

// The page deliberately renders an explanation instead of a map when the key is
// missing; give it one so the pins mount.
vi.mock("@/lib/env", () => ({
  env: { apiBaseUrl: "http://api.test", googleMapsApiKey: "test-key" },
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
      HttpResponse.json({ success: true, data: [], pagination: { count: 0 } }),
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
});
