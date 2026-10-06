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
 * The jobs list does not jump.
 *
 * The status tabs were drawn at once and their numbers came a beat later; a
 * chip holding "1,325" is wider than the room kept for it, so every tab to its
 * right slid across — on every visit, and again on every filter change, when
 * the numbers blanked out and came back. And the rows came before the job
 * types, so the Job type column showed grey bars and then filled in.
 *
 * Now the tabs, their numbers and the rows are drawn in one frame, and a
 * filter change keeps the old numbers until the new ones are in.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/deals",
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
  usePermissions: () => ({ can: () => true, isTechnician: false, isLoading: false, me: { id: "u-disp" } }),
}));

const row = (n: number): Deal => ({
  id: `d${n}`,
  dealNumber: `10${n}`,
  contactId: `c${n}`,
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "North",
  address: { street: `${n} Main`, city: "Marietta", state: "GA", zip: "30060" },
  jobTypeId: "jt-lockout",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedDispatcherId: "u-disp",
  priority: DealPriority.NORMAL,
  assignedTechIds: [],
  tagIds: [],
  scheduledDate: "2026-10-07",
  status: DealStatus.ACTIVE,
  createdBy: "u-disp",
  createdAt: "",
  updatedAt: "",
});

const counts = (submitted: number) => ({
  submitted,
  in_progress: 11,
  done: 1325,
  pending: 233,
  done_pending_approval: 0,
  canceled: 3245,
  unscheduled: 1,
  total: submitted + 11 + 1325 + 233 + 3245,
});

/** What the counts endpoint answers now — a test may change it mid-way. */
let countsNow = counts(198);

const routes: FakeRoute[] = [
  {
    match: /\/deals$/,
    raw: true,
    reply: () => ({
      success: true,
      data: [row(1), row(2), row(3)],
      pagination: {},
      included: { technicians: [], clients: [1, 2, 3].map((n) => ({ id: `c${n}`, firstName: "Client", lastName: `${n}` })) },
    }),
  },
  // The order the browser sees on a slow afternoon: the rows first, then the
  // numbers, then the job types.
  { match: /\/deals\/counts$/, reply: () => countsNow, delayMs: 60 },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true }], delayMs: 120 },
  { match: /\/deals\/job-tags$/, reply: () => [] },
  { match: /\/deals\/job-sources$/, reply: () => [] },
  { match: /\/deals\/external-companies$/, reply: () => [] },
  { match: /\/deals\/job-statuses$/, reply: () => [] },
  { match: /\/deals\/custom-fields$/, reply: () => [] },
  { match: /\/deals\/service-areas$/, reply: () => [] },
  { match: /\/billing\/business-profiles$/, reply: () => [] },
  { match: /\/users\/technicians$/, raw: true, reply: () => ({ success: true, data: [], pagination: {} }) },
  { match: /\/users$/, raw: true, reply: () => ({ success: true, data: [], pagination: {} }) },
  { match: /\/crm\/contacts\/by-ids$/, reply: () => [] },
];

let server: FakeServer;

const { DealsPage } = await import("./deals-page");

const tabStrip = () => document.querySelector('[role="tablist"][aria-label="Job status"]') as HTMLElement | null;
const stripShown = () => !!tabStrip() && !tabStrip()!.className.split(/\s+/).includes("invisible");
const chips = () => [...tabStrip()!.querySelectorAll('[role="tab"] span')].map((s) => s.textContent?.trim() ?? "");
const rowsUp = () => !!screen.queryByText("#101");

beforeEach(() => {
  countsNow = counts(198);
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DealsPage — no jumping", () => {
  it("draws the rows, the tabs and their numbers in one frame", async () => {
    const watch = watchFirstFrame(rowsUp, () => ({
      stripShown: stripShown(),
      submitted: chips()[0],
      jobType: !!screen.queryAllByText("Lockout").length,
      skeletons: skeletonCount(),
    }));
    renderWithClient(<DealsPage />);
    await screen.findByText("#101", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ stripShown: true, submitted: "198", jobType: true, skeletons: 0 });
  });

  it("never shows the tabs without their numbers", async () => {
    let blank = false;
    const observer = new MutationObserver(() => {
      if (stripShown() && chips().some((c) => c === "")) blank = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    renderWithClient(<DealsPage />);
    await screen.findByText("#101", {}, { timeout: 3000 });

    // A filter the numbers depend on: they are asked for again.
    countsNow = counts(42);
    fireEvent.change(screen.getByLabelText("From hour"), { target: { value: "09:00" } });
    await screen.findByText("42", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blank).toBe(false);
  });

  it("asks for each thing once", async () => {
    renderWithClient(<DealsPage />);
    await screen.findByText("#101", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
