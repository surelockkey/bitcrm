import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { ClientType, DealPriority, DealStatus, JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
import { DEFAULT_VISIBLE } from "../fields";
import { useJobFieldsStore } from "../fields-store";
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
    // Searched (`q`), the list answers the one job the search finds.
    reply: (url) => {
      const ns = url.searchParams.get("q") ? [7] : [1, 2, 3];
      return {
        success: true,
        data: ns.map(row),
        pagination: {},
        included: { technicians: [], clients: ns.map((n) => ({ id: `c${n}`, firstName: "Client", lastName: `${n}` })) },
      };
    },
  },
  // The order the browser sees on a slow afternoon: the rows first, then the
  // numbers, then the job types. Searched, the open tab counts one job.
  { match: /\/deals\/counts$/, reply: (url) => (url.searchParams.get("q") ? counts(1) : countsNow), delayMs: 60 },
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
  // The client's number, printed under the name the Workiz way — it can only
  // be asked for once the rows are in, and it comes last.
  {
    match: /\/crm\/contacts\/by-ids$/,
    reply: () => [
      { id: "c1", firstName: "Client", lastName: "1", phones: ["+14045551234"], emails: [], addresses: [] },
    ],
    delayMs: 80,
  },
];

let server: FakeServer;

const { DealsPage } = await import("./deals-page");

const tabStrip = () => document.querySelector('[role="tablist"][aria-label="Job status"]') as HTMLElement | null;
const stripShown = () => !!tabStrip() && !tabStrip()!.className.split(/\s+/).includes("invisible");
const chips = () => [...tabStrip()!.querySelectorAll('[role="tab"] span')].map((s) => s.textContent?.trim() ?? "");
const rowsUp = () => !!screen.queryByText("101");

beforeEach(() => {
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE }, order: [] });
  countsNow = counts(198);
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DealsPage — no jumping", () => {
  it("draws the rows, the tabs and their numbers, and the client's number, in one frame", async () => {
    const watch = watchFirstFrame(rowsUp, () => ({
      stripShown: stripShown(),
      submitted: chips()[0],
      jobType: !!screen.queryAllByText("Lockout").length,
      phone: !!screen.queryByText("(404) 555-1234"),
      skeletons: skeletonCount(),
    }));
    renderWithClient(<DealsPage />);
    await screen.findByText("101", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ stripShown: true, submitted: "198", jobType: true, phone: true, skeletons: 0 });
  });

  /**
   * Audit L19: Workiz has its five tabs up before the rows; ours left their
   * 70px blank. The strip still waits for its numbers, so five grey tabs
   * hold its place meanwhile, and they go in the frame the real ones come.
   */
  it("holds the tab strip's place with five grey tabs while the list loads", async () => {
    // The strip and what holds its place.
    const tabsArea = () => tabStrip()!.parentElement!;
    renderWithClient(<DealsPage />);
    expect(stripShown()).toBe(false);
    expect(skeletonCount(tabsArea())).toBe(5);

    await screen.findByText("101", {}, { timeout: 3000 });
    expect(skeletonCount(tabsArea())).toBe(0);
  });

  it("never shows the tabs without their numbers", async () => {
    let blank = false;
    const observer = new MutationObserver(() => {
      if (stripShown() && chips().some((c) => c === "")) blank = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    renderWithClient(<DealsPage />);
    await screen.findByText("101", {}, { timeout: 3000 });

    // A filter the numbers depend on: they are asked for again.
    countsNow = counts(42);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Filter results" }));
    fireEvent.change(screen.getByLabelText("From hour"), { target: { value: "09:00" } });
    await screen.findByText("42", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blank).toBe(false);
  });

  /**
   * Workiz keeps its rows while a search is out, then shows the found ones
   * with the open tab's searched number. The rows come back before the
   * searched count here: the frame must still change once, not twice.
   */
  it("a search swaps the rows and the open tab's number in one frame, without a skeleton", async () => {
    // No client column, so no contacts to wait for: the searched rows land
    // well before the searched count, and only the gate can keep them apart.
    useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE, client: false }, order: [] });
    renderWithClient(<DealsPage />);
    await screen.findByText("101", {}, { timeout: 3000 });

    let skeleton = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0) skeleton = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    const watch = watchFirstFrame(
      () => !!screen.queryByText("107"),
      () => ({ submitted: chips()[0], oldRows: !!screen.queryByText("101") }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "Dustin" } });
    await screen.findByText("107", {}, { timeout: 3000 });
    watch.stop();
    observer.disconnect();

    expect(watch.frame()).toEqual({ submitted: "1", oldRows: false });
    expect(skeleton).toBe(false);
    // The other tabs kept their unsearched numbers.
    expect(chips()[2]).toBe("233");
  });

  it("asks for each thing once", async () => {
    renderWithClient(<DealsPage />);
    await screen.findByText("101", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
