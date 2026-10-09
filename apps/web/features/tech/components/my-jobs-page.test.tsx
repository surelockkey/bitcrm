import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { ClientType, DealPriority, DealStatus, JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import { DEFAULT_VISIBLE } from "@/features/deals/fields";
import { useJobFieldsStore } from "@/features/deals/fields-store";
import { installFakeServer, renderWithClient, type FakeRoute, type FakeServer } from "@/test/page-load";

/**
 * `/my-jobs` is Workiz's jobs list as a technician sees it (list_01): the
 * same Filter results, status tabs, grey strip and grid — holding only the
 * jobs the viewer is on, each opening on the technician's own job page.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/my-jobs",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** What the signed-in viewer may do — a test narrows it. */
let granted = (resource: string, action = "view") => resource === "deals" && action !== "create";
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action?: string) => !granted(resource, action),
  usePermissions: () => ({
    can: (resource: string, action?: string) => granted(resource, action),
    isTechnician: true,
    isLoading: false,
    me: { id: "t1", firstName: "Tess", lastName: "Tech" },
  }),
}));

const row = (n: number): Deal => ({
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
  scheduledDate: "2026-10-09",
  status: DealStatus.ACTIVE,
  createdBy: "u-disp",
  createdAt: "",
  updatedAt: "",
});

const counts = { submitted: 2, in_progress: 1, pending: 0, done_pending_approval: 0, done: 4, canceled: 0, unscheduled: 0, total: 7 };

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "t1", firstName: "Tess", lastName: "Tech" }) },
  {
    match: /\/deals$/,
    raw: true,
    reply: () => ({
      success: true,
      data: [row(1), row(2)],
      pagination: {},
      included: {
        technicians: [{ id: "t1", firstName: "Tess", lastName: "Tech" }],
        clients: [
          { id: "c1", firstName: "Ivy", lastName: "Quill" },
          { id: "c2", firstName: "Otto", lastName: "Brisk" },
        ],
      },
    }),
  },
  { match: /\/deals\/counts$/, reply: () => counts },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true }] },
  { match: /\/deals\/job-tags$/, reply: () => [{ id: "tag-1", name: "Needs a call", color: "blue", active: true }] },
  { match: /\/deals\/job-sources$/, reply: () => [] },
  { match: /\/deals\/external-companies$/, reply: () => [] },
  { match: /\/deals\/job-statuses$/, reply: () => [] },
  { match: /\/deals\/custom-fields$/, reply: () => [] },
  { match: /\/deals\/service-areas$/, reply: () => [{ id: "a1", name: "North", active: true }] },
  { match: /\/billing\/business-profiles$/, reply: () => [] },
  { match: /\/messaging\/team\/counters$/, reply: () => ({ unreadConversations: 0, unreadByKind: {} }) },
  {
    match: /\/crm\/contacts\/by-ids$/,
    reply: () => [{ id: "c1", firstName: "Ivy", lastName: "Quill", phones: ["+14045550123"], emails: [], addresses: [] }],
  },
];

let server: FakeServer;

const { MyJobsPage } = await import("./my-jobs-page");

beforeEach(() => {
  push.mockReset();
  granted = (resource: string, action = "view") => resource === "deals" && action !== "create";
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE }, order: [] });
  server = installFakeServer(routes, { delayMs: 5 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MyJobsPage — the jobs list, only mine", () => {
  it("refuses a viewer who may not see jobs", () => {
    granted = () => false;
    renderWithClient(<MyJobsPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });

  it("asks for the viewer's own jobs, the rows and the tab numbers alike", async () => {
    renderWithClient(<MyJobsPage />);
    await screen.findByText("901", {}, { timeout: 3000 });

    const list = server.requests.filter((r) => /\/deals\?/.test(r));
    const tabNumbers = server.requests.filter((r) => /\/deals\/counts\?/.test(r));
    expect(list.length).toBeGreaterThan(0);
    expect(tabNumbers.length).toBeGreaterThan(0);
    for (const r of [...list, ...tabNumbers]) expect(new URLSearchParams(r.split("?")[1]).get("techIds")).toBe("t1");
  });

  it("draws Workiz's five status tabs with their numbers, Submitted open", async () => {
    renderWithClient(<MyJobsPage />);
    await screen.findByText("901", {}, { timeout: 3000 });

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["Submitted 2", "In Progress 1", "Pending 0", "Done Pending Approval 0", "Unscheduled 0"]);
    expect(screen.getByRole("tab", { name: /Submitted/ })).toHaveAttribute("aria-selected", "true");
  });

  it("opens a row on the technician's own job page", async () => {
    renderWithClient(<MyJobsPage />);
    fireEvent.click(await screen.findByText("901", {}, { timeout: 3000 }));
    expect(push).toHaveBeenCalledWith("/my-jobs/d1");
  });

  it("offers no TECHS column in Filter results — the list is always yours", async () => {
    renderWithClient(<MyJobsPage />);
    await screen.findByText("901", {}, { timeout: 3000 });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Filter results" }));

    expect(screen.queryByRole("listbox", { name: "Techs" })).not.toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Tags" })).toBeInTheDocument();
  });

  it("has the strip's Search, Show unpaid jobs, page size and Fields", async () => {
    renderWithClient(<MyJobsPage />);
    await screen.findByText("901", {}, { timeout: 3000 });

    expect(screen.getByRole("textbox", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Show unpaid jobs" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fields/ })).toBeInTheDocument();
  });

  it("shows Create New only to a viewer who may create jobs", async () => {
    renderWithClient(<MyJobsPage />);
    await screen.findByText("901", {}, { timeout: 3000 });
    expect(screen.queryByRole("link", { name: /Create New/ })).not.toBeInTheDocument();

    cleanup();
    granted = (resource: string) => resource === "deals";
    renderWithClient(<MyJobsPage />);
    await screen.findByText("901", {}, { timeout: 3000 });
    expect(screen.getByRole("link", { name: /Create New/ })).toHaveAttribute("href", "/deals/new");
  });

  it("carries the team chat pill, for a viewer who may read team chat", async () => {
    renderWithClient(<MyJobsPage />);
    await screen.findByText("901", {}, { timeout: 3000 });
    expect(screen.queryByTestId("team-chat-badge")).not.toBeInTheDocument();

    cleanup();
    granted = (resource: string, action = "view") => (resource === "deals" && action !== "create") || resource === "team_chat";
    renderWithClient(<MyJobsPage />);
    await screen.findByText("901", {}, { timeout: 3000 });
    expect(screen.getByTestId("team-chat-badge")).toHaveAttribute("href", "/messages?kind=team");
  });

  it("says so when the list could not be loaded", async () => {
    server.fail(/\/deals$/);
    renderWithClient(<MyJobsPage />);
    expect(await screen.findByText("Couldn't load your jobs", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
