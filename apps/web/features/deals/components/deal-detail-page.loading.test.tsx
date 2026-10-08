import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
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
import {
  ClientType,
  ContactSource,
  ContactType,
  CrmStatus,
  DealPriority,
  DealStatus,
  JobSuperStatus,
} from "@bitcrm/types";
import type { Contact, Deal } from "@bitcrm/types";

/**
 * The job page appears once, whole.
 *
 * It used to fill in waves: the job and its catalogs behind one skeleton, and
 * then the client, the service area, the team's names, the dial-in card and
 * "N can do this job" each asked for by its own block only once that block
 * had mounted — so a dispatcher watched the page arrive over five seconds.
 *
 * This renders the real page against a fake server and looks at the very
 * first frame in which the job shows: everything it shows must already be
 * in, and nothing more may be asked for afterwards. A block that starts
 * fetching for itself again fails here.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/deals/d1",
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
// Live, not page content: the call you are on right now polls on its own clock.
vi.mock("@/features/calls/components/live-call-strip", () => ({ LiveCallStrip: () => null }));

const contact: Contact = {
  id: "c1",
  firstName: "Jane",
  lastName: "Smith",
  phones: ["+14045551234"],
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const deal: Deal = {
  id: "d1",
  dealNumber: "1042",
  contactId: "c1",
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "North",
  serviceAreaId: "sa-1",
  address: { street: "1 Main", city: "Marietta", state: "GA", zip: "30060", lat: 33.95, lng: -84.55 },
  jobTypeId: "jt-lockout",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedDispatcherId: "u-disp",
  priority: DealPriority.NORMAL,
  assignedTechIds: ["t1"],
  tagIds: [],
  status: DealStatus.ACTIVE,
  createdBy: "u-disp",
  createdAt: "",
  updatedAt: "",
};

/** What the server holds for the job now — a test may move it after the page is up. */
let currentDeal: Deal = deal;
let currentContact: Contact = contact;

const area = { id: "sa-1", name: "North Metro", active: true, priority: 1, timezone: "America/New_York" };

/** The fake server: path (no query string) → what it answers. */
const routes: FakeRoute[] = [
  { match: /\/deals\/d1$/, reply: () => currentDeal },
  { match: /\/deals\/d1\/attachments$/, reply: () => [] },
  { match: /\/deals\/d1\/assignments$/, reply: () => [] },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true }] },
  { match: /\/deals\/job-sources$/, reply: () => [] },
  // An archived source a job still names is asked for by itself (Job source shows its name).
  { match: /\/deals\/job-sources\/src-old$/, reply: () => ({ id: "src-old", name: "Yellow Pages", active: false, priority: 0 }) },
  { match: /\/deals\/external-companies$/, reply: () => [] },
  { match: /\/billing\/business-profiles$/, reply: () => [] },
  { match: /\/deals\/custom-fields$/, reply: () => [] },
  { match: /\/deals\/job-statuses$/, reply: () => [] },
  { match: /\/deals\/job-tags$/, reply: () => [] },
  { match: /\/crm\/contacts\/c1$/, reply: () => currentContact },
  // Company name: the client's CRM company.
  { match: /\/crm\/companies\/co-1$/, reply: () => ({ id: "co-1", title: "Acme Locks" }) },
  { match: /\/messaging\/settings$/, reply: () => ({}) },
  { match: /\/deals\/service-areas$/, reply: () => [area] },
  { match: /\/deals\/service-areas\/resolve$/, reply: () => area },
  { match: /\/deals\/service-areas\/nearest$/, reply: () => null },
  {
    match: /\/deals\/qualified-techs$/,
    reply: () => [{ id: "t1", firstName: "Bo", lastName: "Diaz", eligible: true, reasons: [], jobTypeIds: ["jt-lockout"], serviceAreaIds: ["sa-1"] }],
  },
  { match: /\/telephony\/config$/, reply: () => ({ technicianLine: "+14045550140" }) },
  { match: /\/telephony\/exts\/by-deal\/d1$/, reply: () => ({ code: "8707" }) },
  { match: /\/billing\/invoices\/by-deal\/d1$/, reply: () => null },
  { match: /\/billing\/deals\/d1\/payments$/, reply: () => ({ balanceDue: 0, payments: [] }) },
  // The right rail's notes badge and the Estimates tab's "0 estimates".
  {
    match: /\/deals\/d1\/timeline$/,
    raw: true,
    reply: () => ({
      success: true,
      data: [
        { id: "n1", dealId: "d1", eventType: "note_added", actorId: "u-disp", actorName: "Dee", timestamp: "2026-10-01T10:00:00.000Z", note: "Gate code 1234" },
      ],
      pagination: { count: 1 },
    }),
  },
  { match: /\/billing\/estimates\/by-deal\/d1$/, reply: () => [] },
  {
    match: /\/users$/,
    raw: true,
    reply: () => ({ success: true, data: [{ id: "t1", firstName: "Bo", lastName: "Diaz", email: "bo@example.com" }], pagination: {} }),
  },
];

let server: FakeServer;
let client: QueryClient;

/** The job is up: its number is on screen. */
const jobIsUp = () => !!document.body.textContent?.includes("#1042");

/** What the page held in the very first frame the job was on screen. */
function watchJobFirstFrame() {
  return watchFirstFrame(jobIsUp, () => ({
    requestsSoFar: server.requests.length,
    clientName: !!screen.queryByDisplayValue("Jane"),
    techName: !!screen.queryByText("Bo Diaz"),
    findingTechs: !!screen.queryByText(/finding technicians/i),
    // Workiz's line under Assign A Tech: "1 tech works in North Metro and can perform Lockout".
    techSummary: !!screen.queryByText(/and can perform/i),
    // Our dial-in, drawn as Workiz's "Masked number (404) 555-0140 #8707".
    dialIn: !!screen.queryByText(/#8707/),
    areaName: !!screen.queryAllByText(/north metro/i).length,
    // The frame Workiz draws around the form: the rail's notes count and the
    // tab bar's grey lines are part of the page, not a later wave.
    notesBadge: !!screen.queryByRole("button", { name: "Notes (1)" }),
    jobTypeLine: !!screen.queryByText("Lockout", { selector: "#job-tab-details-sub" }),
    estimatesLine: !!screen.queryByText("0 estimates"),
    skeletons: skeletonCount(),
  }));
}

const { DealDetailPage } = await import("./deal-detail-page");

function renderPage() {
  ({ client } = renderWithClient(<DealDetailPage dealId="d1" />));
}

beforeEach(() => {
  currentDeal = deal;
  currentContact = contact;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DealDetailPage — one load, not waves", () => {
  it("shows the job only once everything on it has arrived", async () => {
    const watch = watchJobFirstFrame();
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    watch.stop();

    const first = watch.frame();
    expect(first).not.toBeNull();
    expect(first).toMatchObject({
      clientName: true,
      techName: true,
      findingTechs: false,
      techSummary: true,
      dialIn: true,
      areaName: true,
      notesBadge: true,
      jobTypeLine: true,
      estimatesLine: true,
      skeletons: 0,
    });
  });

  it("asks for nothing more once the job is on screen", async () => {
    const watch = watchJobFirstFrame();
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    watch.stop();
    // Long enough for any block that fetches for itself to have asked.
    await settle();

    const asked = watch.frame()!.requestsSoFar;
    expect(server.requests.slice(asked)).toEqual([]);
  });

  /**
   * A block that finds its answer already in hand must not ask again as it
   * mounts — a second request for the same thing is the old wave, just quieter.
   */
  it("asks for each thing once", async () => {
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });

  it("asks for the technicians once, with the address — not again once the area resolves", async () => {
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    await settle();

    const suggestions = server.requests.filter((r) => r.includes("/deals/qualified-techs"));
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).not.toContain("serviceAreaId");
  });

  /**
   * Behind the skeleton is the dispatcher's unsaved draft. A saved address
   * comes back as a job with new coordinates — so a new area and new
   * suggestions to ask for — and that must never take the page away to wait.
   */
  it("once shown, a job that comes back changed never goes back to the skeleton", async () => {
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });

    let lost = false;
    const observer = new MutationObserver(() => {
      if (!document.body.textContent?.includes("#1042")) lost = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    currentDeal = { ...deal, address: { ...deal.address, lat: 34.02, lng: -84.36 } };
    await client.invalidateQueries();
    await settle();
    observer.disconnect();

    expect(lost).toBe(false);
  });

  /**
   * Job source names a source the catalog has archived (imported Workiz jobs
   * do): its name is asked for by itself — with the page, not after it.
   */
  it("asks for an archived job source before showing the job", async () => {
    currentDeal = { ...deal, sourceId: "src-old" };
    const watch = watchFirstFrame(jobIsUp, () => ({ sourceName: !!screen.queryByText(/yellow pages/i) }));
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ sourceName: true });
  });

  /** Company name names the client's company, which is asked for with the page. */
  it("shows the client's company in the first frame", async () => {
    currentContact = { ...contact, companyId: "co-1" };
    const watch = watchFirstFrame(jobIsUp, () => ({ company: !!screen.queryByDisplayValue("Acme Locks") }));
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ company: true });
  });

  it("a request that fails does not hold the job off the screen", async () => {
    server.fail(/\/deals\/qualified-techs$/);
    renderPage();

    expect(await screen.findByText("#1042", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
