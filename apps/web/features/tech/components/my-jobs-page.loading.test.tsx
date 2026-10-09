import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { ClientType, DealPriority, DealStatus, JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import { DEFAULT_VISIBLE } from "@/features/deals/fields";
import { useJobFieldsStore } from "@/features/deals/fields-store";
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
 * The technician's jobs list appears once, whole — the way `/deals` does.
 *
 * The rows, the five tabs with their numbers, the job types the grid prints
 * and the client's number under the name land on their own schedules; the
 * page holds one skeleton (and five grey tabs) until every one is in, and
 * then draws them in a single frame. Nothing is asked before the viewer is
 * known — the list is theirs, so without the id there is no list to ask for.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
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
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action?: string) => !(resource === "deals" && action === "create"),
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

const routes: FakeRoute[] = [
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
    delayMs: 10,
  },
  // The order a slow afternoon brings them in: rows, then the numbers, then
  // the job types, the client's number last.
  {
    match: /\/deals\/counts$/,
    reply: () => ({ submitted: 2, in_progress: 1, pending: 0, done_pending_approval: 0, done: 4, canceled: 0, unscheduled: 0, total: 7 }),
    delayMs: 60,
  },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true }], delayMs: 120 },
  { match: /\/deals\/job-tags$/, reply: () => [] },
  { match: /\/deals\/job-sources$/, reply: () => [] },
  { match: /\/deals\/external-companies$/, reply: () => [] },
  { match: /\/deals\/job-statuses$/, reply: () => [] },
  { match: /\/deals\/custom-fields$/, reply: () => [] },
  { match: /\/deals\/service-areas$/, reply: () => [] },
  { match: /\/billing\/business-profiles$/, reply: () => [] },
  {
    match: /\/crm\/contacts\/by-ids$/,
    reply: () => [{ id: "c1", firstName: "Ivy", lastName: "Quill", phones: ["+14045550123"], emails: [], addresses: [] }],
    delayMs: 150,
  },
  // The chat pill's unread count, slowest of all.
  { match: /\/messaging\/team\/counters$/, reply: () => ({ unreadConversations: 2, unreadByKind: {} }), delayMs: 200 },
];

let server: FakeServer;

const { MyJobsPage } = await import("./my-jobs-page");

const tabStrip = () => document.querySelector('[role="tablist"][aria-label="Job status"]') as HTMLElement | null;
const stripShown = () => !!tabStrip() && !tabStrip()!.closest(".invisible");
const chips = () => [...tabStrip()!.querySelectorAll('[role="tab"] span')].map((s) => s.textContent?.trim() ?? "");
const rowsUp = () => !!screen.queryByText("901");

beforeEach(() => {
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE }, order: [] });
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MyJobsPage — one load", () => {
  it("draws the rows, the tabs with their numbers, the job type and the client's number in one frame", async () => {
    const watch = watchFirstFrame(rowsUp, () => ({
      stripShown: stripShown(),
      submitted: chips()[0],
      jobType: screen.queryAllByText("Lockout").length > 0,
      phone: !!screen.queryByText("(404) 555-0123"),
      chatUnread: screen.queryByTestId("team-chat-unread")?.textContent ?? null,
      skeletons: skeletonCount(),
    }));
    renderWithClient(<MyJobsPage />);
    expect(skeletonCount()).toBeGreaterThan(0);
    await screen.findByText("901", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ stripShown: true, submitted: "2", jobType: true, phone: true, chatUnread: "2", skeletons: 0 });
  });

  it("asks for each thing once, and never for a list that is not the viewer's", async () => {
    renderWithClient(<MyJobsPage />);
    await screen.findByText("901", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
    const lists = server.requests.filter((r) => /\/deals(\/counts)?\?/.test(r));
    expect(lists.every((r) => r.includes("techIds=t1"))).toBe(true);
  });
});
