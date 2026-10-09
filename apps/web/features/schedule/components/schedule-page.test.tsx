import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { localTodayISO } from "../calendar";
import { SchedulePage } from "./schedule-page";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push, prefetch: vi.fn() }),
}));

const permissions = vi.hoisted(() => ({
  value: {
    can: (() => true) as (resource: string, action: string) => boolean,
    scopeOf: () => "all",
    isTechnician: false,
    roleName: "Admin",
    me: undefined,
    isLoading: false,
  },
}));
vi.mock("@/features/auth/use-permissions", () => ({
  // The permissions are in: a refusal is whatever `can` says.
  useDenied: () => (resource: string, action = "view") => !permissions.value.can(resource, action),
  usePermissions: () => permissions.value,
}));

// The calendar opens on the browser's today, as Workiz's does.
const today = localTodayISO();

const DEAL = {
  id: "deal-1",
  dealNumber: "AB12CD",
  contactId: "contact-1",
  clientType: "residential",
  serviceArea: "Austin",
  address: { street: "1 Main", city: "Austin", state: "TX", zip: "78701" },
  jobTypeId: "jt-lockout",
  superStatus: "submitted",
  assignedTechIds: ["tech-1"],
  assignedDispatcherId: "d1",
  priority: "normal",
  tagIds: [],
  status: "active",
  createdBy: "d1",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-01T10:00:00.000Z",
  scheduledDate: today,
  scheduledTimeSlot: "09:00-11:00",
};

const UNDATED = {
  ...DEAL,
  id: "deal-2",
  dealNumber: "UN5CHD",
  contactId: "contact-2",
  assignedTechIds: [],
  scheduledDate: undefined,
  scheduledTimeSlot: undefined,
};

const profile = (userId: string, status: string) => ({
  userId,
  status,
  callMaskingEnabled: false,
  gpsTrackingEnabled: false,
  mobileAppInstalled: false,
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  workStart: "08:00",
  workEnd: "17:00",
});

function mockApi({ deals = [DEAL], undated = [UNDATED] }: { deals?: unknown[]; undated?: unknown[] } = {}) {
  server.use(
    http.get("*/deals", ({ request }) =>
      new URL(request.url).searchParams.get("unscheduled") === "true"
        ? HttpResponse.json({ success: true, data: undated, pagination: {} })
        : HttpResponse.json({ success: true, data: deals, pagination: {} }),
    ),
    http.post("*/contacts/by-ids", () =>
      HttpResponse.json({
        success: true,
        data: [{ id: "contact-2", firstName: "Ada", lastName: "Lovelace", phones: [], emails: [] }],
      }),
    ),
    http.get("*/deals/job-types", () =>
      HttpResponse.json({ success: true, data: [{ id: "jt-lockout", name: "Car lockout", active: true }] }),
    ),
    http.get("*/users/roles", () => HttpResponse.json({ success: true, data: [{ id: "role-technician", name: "tech" }] })),
    http.get("*/users/technicians/calendar-events", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/users/technicians", () =>
      HttpResponse.json({
        success: true,
        data: [profile("tech-1", "active"), profile("tech-2", "active"), profile("tech-3", "inactive")],
        pagination: { count: 3 },
      }),
    ),
    http.get("*/users", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "tech-1", firstName: "Sam", lastName: "Ochoa", email: "sam@x.com", roleId: "role-technician" },
          { id: "tech-2", firstName: "Nia", lastName: "Holt", email: "nia@x.com", roleId: "role-technician" },
          { id: "tech-3", firstName: "Dana", lastName: "Reeves", email: "dana@x.com", roleId: "role-technician" },
        ],
        pagination: { count: 3 },
      }),
    ),
    http.get("*/deals/job-tags", () => HttpResponse.json({ success: true, data: [] })),
    http.get("*/deals/service-areas", () => HttpResponse.json({ success: true, data: [] })),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const job = () => screen.findByRole("button", { name: "Job ID: AB12CD" }, { timeout: 3000 });

beforeEach(() => {
  push.mockReset();
  permissions.value = {
    can: () => true,
    scopeOf: () => "all",
    isTechnician: false,
    roleName: "Admin",
    me: undefined,
    isLoading: false,
  };
  mockApi();
});

describe("SchedulePage — Workiz's Schedule", () => {
  it("opens on today's Day view with the job worded by the Workiz template", async () => {
    render(<SchedulePage />, { wrapper });
    const box = await job();
    expect(within(box).getByText("Job ID: AB12CD")).toBeInTheDocument();
    expect(box).toHaveTextContent("AB12CD Car lockout, Austin , 1 Main, Austin, TX 78701 Sam Ochoa");
    expect(screen.getByRole("tab", { name: "Day" })).toHaveAttribute("aria-selected", "true");
  });

  it("asks the server for the day it shows, not the whole table", async () => {
    const urls: string[] = [];
    server.use(
      http.get("*/deals", ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ success: true, data: [], pagination: {} });
      }),
    );
    render(<SchedulePage />, { wrapper });
    await waitFor(() => expect(urls.some((u) => new URL(u).searchParams.get("scheduledFrom"))).toBe(true));
    const q = new URL(urls.find((u) => new URL(u).searchParams.get("scheduledFrom"))!).searchParams;
    expect(q.get("scheduledFrom")).toBe(today);
    expect(q.get("scheduledTo")).toBe(today);
    expect(q.get("sort")).toBe("schedule");
  });

  it("has Workiz's five views", async () => {
    render(<SchedulePage />, { wrapper });
    await job();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Day", "Week", "Month", "Timeline", "Timeline Week"]);
  });

  it("shows the manager's Add time off, and hides it from everyone else", async () => {
    const { unmount } = render(<SchedulePage />, { wrapper });
    await job();
    expect(screen.getByRole("button", { name: "Add time off" })).toBeInTheDocument();
    unmount();

    permissions.value = { ...permissions.value, can: (_r: string, a: string) => a === "view" };
    render(<SchedulePage />, { wrapper });
    await job();
    expect(screen.queryByRole("button", { name: "Add time off" })).not.toBeInTheDocument();
  });

  it("Week: seven Sunday-first columns over the hours", async () => {
    render(<SchedulePage />, { wrapper });
    await job();
    await userEvent.click(screen.getByRole("tab", { name: "Week" }));
    expect(await screen.findByText("Sun")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
    expect(await job()).toBeInTheDocument();
  });

  it("Month: the job on its day with its start time", async () => {
    render(<SchedulePage />, { wrapper });
    await job();
    await userEvent.click(screen.getByRole("tab", { name: "Month" }));
    const line = await job();
    expect(line).toHaveTextContent("9:00 AM");
  });

  it("Timeline: Unassigned first, then a row per active field technician with their role", async () => {
    render(<SchedulePage />, { wrapper });
    await job();
    await userEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(await screen.findByText("Unassigned")).toBeInTheDocument();
    expect(screen.getByText("Sam Ochoa")).toBeInTheDocument();
    expect(screen.getByText("Nia Holt")).toBeInTheDocument();
    expect(screen.queryByText("Dana Reeves")).not.toBeInTheDocument();
    expect(screen.getAllByText("tech")).toHaveLength(2);
  });

  it("Timeline: a crew's job sits on every crew member's row", async () => {
    mockApi({ deals: [{ ...DEAL, assignedTechIds: ["tech-1", "tech-2"] }] });
    render(<SchedulePage />, { wrapper });
    await job();
    await userEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Job ID: AB12CD" })).toHaveLength(2));
  });

  it("Timeline: someone off the roster who still has a job that day keeps a row", async () => {
    mockApi({ deals: [{ ...DEAL, assignedTechIds: ["tech-3"] }] });
    render(<SchedulePage />, { wrapper });
    await job();
    await userEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(await screen.findByText("Dana Reeves")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Job ID: AB12CD" })).toBeInTheDocument();
  });

  it("counts the unscheduled jobs and lists them in the pane", async () => {
    render(<SchedulePage />, { wrapper });
    await job();
    const toggle = screen.getByRole("button", { name: "Unscheduled jobs" });
    expect(toggle).toHaveTextContent("1");
    await userEvent.click(toggle);
    const pane = screen.getByRole("complementary", { name: "Unscheduled jobs" });
    expect(within(pane).getByText("Drag and drop to schedule the job.")).toBeInTheDocument();
    expect(within(pane).getByText("Job #UN5CHD")).toBeInTheDocument();
    expect(within(pane).getByText("Car lockout")).toBeInTheDocument();
    expect(within(pane).getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("says when there is nothing unscheduled", async () => {
    mockApi({ undated: [] });
    render(<SchedulePage />, { wrapper });
    await job();
    await userEvent.click(screen.getByRole("button", { name: "Unscheduled jobs" }));
    expect(screen.getByText("You have no unscheduled jobs")).toBeInTheDocument();
  });

  it("Filter results narrows the calendar to the picked technician's jobs", async () => {
    mockApi({ deals: [DEAL, { ...DEAL, id: "deal-3", dealNumber: "NI4HLT", assignedTechIds: ["tech-2"] }] });
    render(<SchedulePage />, { wrapper });
    await job();
    expect(screen.getByRole("button", { name: "Job ID: NI4HLT" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Filter results" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Filter results" }));
    await userEvent.click(within(screen.getByRole("listbox", { name: "Team" })).getByText("Sam Ochoa"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Job ID: NI4HLT" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Job ID: AB12CD" })).toBeInTheDocument();
  });

  it("leaves canceled jobs off the calendar", async () => {
    mockApi({ deals: [DEAL, { ...DEAL, id: "deal-4", dealNumber: "CANC3L", superStatus: "canceled" }] });
    render(<SchedulePage />, { wrapper });
    await job();
    expect(screen.queryByRole("button", { name: "Job ID: CANC3L" })).not.toBeInTheDocument();
  });

  it("opens the job when it is clicked", async () => {
    render(<SchedulePage />, { wrapper });
    await userEvent.click(await job());
    expect(push).toHaveBeenCalledWith("/deals/deal-1");
  });

  it("‹ › move a day in Day view and Today comes back", async () => {
    const urls: string[] = [];
    server.use(
      http.get("*/deals", ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json({ success: true, data: [], pagination: {} });
      }),
    );
    render(<SchedulePage />, { wrapper });
    await screen.findByRole("button", { name: "Next" });
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(urls.some((u) => new URL(u).searchParams.get("scheduledFrom") !== today && new URL(u).searchParams.get("scheduledFrom"))).toBe(true),
    );
  });

  it("blocks access without deals.view", async () => {
    permissions.value = { ...permissions.value, can: () => false };
    render(<SchedulePage />, { wrapper });
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });
});
