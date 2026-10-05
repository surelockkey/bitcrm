import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

const area = { id: "sa-1", name: "North Metro", active: true, priority: 1, timezone: "America/New_York" };

/** The fake server: path (no query string) → what it answers. */
const routes: [RegExp, () => unknown][] = [
  [/\/deals\/d1$/, () => currentDeal],
  [/\/deals\/d1\/attachments$/, () => []],
  [/\/deals\/d1\/assignments$/, () => []],
  [/\/deals\/job-types$/, () => [{ id: "jt-lockout", name: "Lockout", active: true }]],
  [/\/deals\/job-sources$/, () => []],
  [/\/deals\/external-companies$/, () => []],
  [/\/billing\/business-profiles$/, () => []],
  [/\/deals\/custom-fields$/, () => []],
  [/\/deals\/job-statuses$/, () => []],
  [/\/deals\/job-tags$/, () => []],
  [/\/crm\/contacts\/c1$/, () => contact],
  [/\/messaging\/settings$/, () => ({})],
  [/\/deals\/service-areas$/, () => [area]],
  [/\/deals\/service-areas\/resolve$/, () => area],
  [/\/deals\/service-areas\/nearest$/, () => null],
  [
    /\/deals\/qualified-techs$/,
    () => [{ id: "t1", firstName: "Bo", lastName: "Diaz", eligible: true, reasons: [], jobTypeIds: ["jt-lockout"], serviceAreaIds: ["sa-1"] }],
  ],
  [/\/telephony\/config$/, () => ({ technicianLine: "+14045550140" })],
  [/\/telephony\/exts\/by-deal\/d1$/, () => ({ code: "8707" })],
  [/\/billing\/invoices\/by-deal\/d1$/, () => null],
  [/\/billing\/deals\/d1\/payments$/, () => ({ balanceDue: 0, payments: [] })],
];

let requests: string[] = [];
/** Paths that should never fail; the one a test breaks on purpose. */
let failing: RegExp | null = null;

function fakeServer(input: RequestInfo | URL) {
  const url = new URL(typeof input === "string" ? input : input.toString(), "http://test");
  requests.push(url.pathname + url.search);
  // A beat per answer, like a network — the waves only show with time between them.
  return new Promise<Response>((resolve) =>
    setTimeout(() => {
      if (url.pathname.endsWith("/users")) {
        const body = {
          success: true,
          data: [{ id: "t1", firstName: "Bo", lastName: "Diaz", email: "bo@example.com" }],
          pagination: {},
        };
        resolve(new Response(JSON.stringify(body), { status: 200 }));
        return;
      }
      if (failing?.test(url.pathname)) {
        resolve(new Response(JSON.stringify({ success: false, message: "boom" }), { status: 500 }));
        return;
      }
      const route = routes.find(([re]) => re.test(url.pathname));
      const data = route ? route[1]() : null;
      resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }));
    }, 20),
  );
}

/** What the page held in the very first frame the job was on screen. */
interface FirstFrame {
  requestsSoFar: number;
  clientName: boolean;
  techName: boolean;
  findingTechs: boolean;
  techSummary: boolean;
  dialIn: boolean;
  areaName: boolean;
  skeletons: number;
}

function watchFirstFrame(): { frame: () => FirstFrame | null; stop: () => void } {
  let first: FirstFrame | null = null;
  const observer = new MutationObserver(() => {
    if (first || !document.body.textContent?.includes("#1042")) return;
    first = {
      requestsSoFar: requests.length,
      clientName: !!screen.queryByDisplayValue("Jane"),
      techName: !!screen.queryByText("Bo Diaz"),
      findingTechs: !!screen.queryByText(/finding technicians/i),
      techSummary: !!screen.queryByText(/can do this job/i),
      dialIn: !!screen.queryByText(/call from any phone/i),
      areaName: !!screen.queryAllByText(/north metro/i).length,
      skeletons: document.querySelectorAll('[data-slot="skeleton"]').length,
    };
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return { frame: () => first, stop: () => observer.disconnect() };
}

const { DealDetailPage } = await import("./deal-detail-page");

let client: QueryClient;

function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DealDetailPage dealId="d1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  currentDeal = deal;
  requests = [];
  failing = null;
  vi.stubGlobal("fetch", vi.fn(fakeServer));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DealDetailPage — one load, not waves", () => {
  it("shows the job only once everything on it has arrived", async () => {
    const watch = watchFirstFrame();
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
      skeletons: 0,
    });
  });

  it("asks for nothing more once the job is on screen", async () => {
    const watch = watchFirstFrame();
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    watch.stop();
    // Long enough for any block that fetches for itself to have asked.
    await new Promise((r) => setTimeout(r, 200));

    const asked = watch.frame()!.requestsSoFar;
    expect(requests.slice(asked)).toEqual([]);
  });

  /**
   * A block that finds its answer already in hand must not ask again as it
   * mounts — a second request for the same thing is the old wave, just quieter.
   */
  it("asks for each thing once", async () => {
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 200));

    const twice = requests.filter((r, i) => requests.indexOf(r) !== i);
    expect(twice).toEqual([]);
  });

  it("asks for the technicians once, with the address — not again once the area resolves", async () => {
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 200));

    const suggestions = requests.filter((r) => r.startsWith("/deals/qualified-techs") || r.includes("/deals/qualified-techs"));
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
    await new Promise((r) => setTimeout(r, 200));
    observer.disconnect();

    expect(lost).toBe(false);
  });

  it("a request that fails does not hold the job off the screen", async () => {
    failing = /\/deals\/qualified-techs$/;
    renderPage();

    expect(await screen.findByText("#1042", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
