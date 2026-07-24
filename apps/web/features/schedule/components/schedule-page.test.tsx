import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { SchedulePage } from "./schedule-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
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

const today = new Date().toISOString().slice(0, 10);

const DEAL = {
  id: "deal-1",
  dealNumber: 101,
  contactId: "contact-1",
  clientType: "residential",
  serviceArea: "Austin",
  address: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" },
  jobType: "lockout",
  stage: "assigned",
  assignedTechId: "tech-1",
  assignedDispatcherId: "d1",
  priority: "normal",
  tags: [],
  status: "open",
  createdBy: "d1",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
  scheduledDate: today,
  scheduledTimeSlot: "09:00-11:00",
};

function mockApi() {
  server.use(
    http.get("*/deals", () =>
      HttpResponse.json({ success: true, data: [DEAL], pagination: { count: 1 } }),
    ),
    http.get("*/contacts", () =>
      HttpResponse.json({
        success: true,
        data: [{ id: "contact-1", firstName: "Ada", lastName: "Lovelace", phones: [], emails: [] }],
        pagination: { count: 1 },
      }),
    ),
    http.get("*/users/technicians/calendar-events", () =>
      HttpResponse.json({ success: true, data: [] }),
    ),
    http.get("*/users/technicians", () =>
      HttpResponse.json({
        success: true,
        data: [
          {
            userId: "tech-1", status: "active",
            callMaskingEnabled: false, gpsTrackingEnabled: false, mobileAppInstalled: false,
            workingDays: [1, 2, 3, 4, 5], workStart: "08:00", workEnd: "17:00",
          },
          {
            userId: "tech-2", status: "inactive",
            callMaskingEnabled: false, gpsTrackingEnabled: false, mobileAppInstalled: false,
          },
        ],
        pagination: { count: 2 },
      }),
    ),
    http.get("*/users", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "tech-1", firstName: "Sam", lastName: "Ochoa", email: "sam@x.com", roleId: "role-technician", department: "East" },
          { id: "tech-2", firstName: "Dana", lastName: "Reeves", email: "dana@x.com", roleId: "role-technician", department: "West" },
        ],
        pagination: { count: 2 },
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

describe("SchedulePage", () => {
  it("renders the day grid with a technician column and a job block", async () => {
    render(<SchedulePage />, { wrapper });
    expect(await screen.findByText("Sam Ochoa")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/#101 · Ada Lovelace/)).toBeInTheDocument(),
    );
  });

  it("shows the manager-only Add time off action", async () => {
    render(<SchedulePage />, { wrapper });
    expect(await screen.findByRole("button", { name: /add time off/i })).toBeInTheDocument();
  });

  it("hides Add time off for non-managers", async () => {
    permissions.value = {
      ...permissions.value,
      can: (_r: string, a: string) => a === "view", // deals.view yes, technicians.edit no
    };
    render(<SchedulePage />, { wrapper });
    await screen.findByText("Sam Ochoa");
    expect(screen.queryByRole("button", { name: /add time off/i })).not.toBeInTheDocument();
  });

  it("switches to a compact week view", async () => {
    render(<SchedulePage />, { wrapper });
    await screen.findByText("Sam Ochoa");
    await userEvent.click(screen.getByRole("tab", { name: "Week" }));
    // Week grid shows day-of-week headers and a per-day count, not proportional blocks.
    expect(await screen.findByText("Mon")).toBeInTheDocument();
    expect(screen.getByText(/1 job/)).toBeInTheDocument();
  });

  it("shows only active technicians by default (Active-only filter)", async () => {
    render(<SchedulePage />, { wrapper });
    // Sam (active) shows; Dana (inactive) is hidden by the default Active-only filter.
    expect(await screen.findByText("Sam Ochoa")).toBeInTheDocument();
    expect(screen.queryByText("Dana Reeves")).not.toBeInTheDocument();
    expect(screen.getByText(/1 technician/)).toBeInTheDocument();
  });

  it("filters technicians by a name search", async () => {
    render(<SchedulePage />, { wrapper });
    await screen.findByText("Sam Ochoa");
    await userEvent.type(screen.getByPlaceholderText("Search technicians…"), "nomatch");
    expect(screen.queryByText("Sam Ochoa")).not.toBeInTheDocument();
    expect(screen.getByText(/0 technicians/)).toBeInTheDocument();
  });

  it("blocks access without deals.view", async () => {
    permissions.value = { ...permissions.value, can: () => false };
    render(<SchedulePage />, { wrapper });
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });
});
