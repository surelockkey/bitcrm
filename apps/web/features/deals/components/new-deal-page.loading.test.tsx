import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";

/**
 * With the app's own query defaults (app/providers.tsx): an answer is fresh
 * for 30 s, so a field that mounts with the form reads what the page asked
 * for a moment earlier instead of asking again — as it does in the browser.
 * `renderWithClient` runs with no staleTime at all, where the company list
 * and the call (whose hooks set none of their own) would count twice.
 */
function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

/**
 * The New Job form appears once, whole — and is never taken away again.
 *
 * It used to be drawn at once and filled in under the dispatcher: the
 * custom-field cards arrived a beat after the form and pushed the
 * "Work order / Platinum" card down (the 0.0227 layout shift the browser
 * measured), the company read "Loading…", the required marks came late —
 * and opened from a call, the form drew itself empty and then again with the
 * caller in it, their area "Detecting…", "Finding technicians…".
 *
 * This renders the real page against a fake server and looks at the very
 * first frame the form shows. A form is a draft: once up it must stay up.
 */

const nav = vi.hoisted(() => ({ params: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.params),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isTechnician: false, isLoading: false, me: { id: "u-disp" } }),
}));
// No Maps key: the address is typed by hand, as it is without Google.
vi.mock("@/lib/env", () => ({
  env: { apiBaseUrl: "http://api.test", googleMapsApiKey: "", googleMapsMapId: "" },
}));

const contact: Contact = {
  id: "c1",
  firstName: "Ivy",
  lastName: "Quill",
  phones: ["+14045550123"],
  emails: [],
  addresses: [{ street: "12 Birch Ln", unit: "", city: "Testville", state: "GA", zip: "30001", lat: 33.91, lng: -84.41 }],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.PHONE_CALL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const area = { id: "sa-1", name: "North Metro", active: true, priority: 1, timezone: "America/New_York", coverage: [] };

const customField = {
  id: "cf-gate",
  name: "Gate code",
  type: "text",
  group: "Access",
  jobTypeIds: [],
  required: false,
  requiredToClose: false,
  searchable: false,
  priority: 1,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const routes: FakeRoute[] = [
  { match: /\/deals\/job-tags$/, reply: () => [] },
  { match: /\/crm\/companies$/, raw: true, reply: () => ({ success: true, data: [], pagination: {} }) },
  // The catalog that came last and pushed the cards below it down.
  { match: /\/deals\/custom-fields$/, reply: () => [customField], delayMs: 80 },
  { match: /\/deals\/job-field-settings$/, reply: () => ({ requiredFields: { source: true } }), delayMs: 50 },
  { match: /\/deals\/service-areas$/, reply: () => [area] },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true, priority: 1 }] },
  { match: /\/deals\/job-sources$/, reply: () => [{ id: "src-web", name: "Website", active: true, priority: 1 }] },
  {
    match: /\/billing\/business-profiles$/,
    reply: () => [{ id: "bp-1", name: "Keystone Locks", isDefault: true, active: true }],
    delayMs: 60,
  },
  { match: /\/deals\/external-companies$/, reply: () => [] },
  // The directory the team picker names people from — nothing on screen waits on it.
  { match: /\/users$/, raw: true, reply: () => ({ success: true, data: [], pagination: {} }) },
  // Opened from a call: the caller, the call, the area and who can go.
  { match: /\/crm\/contacts\/c1$/, reply: () => contact, delayMs: 40 },
  {
    match: /\/telephony\/calls\/CA1$/,
    reply: () => ({ callSid: "CA1", direction: "inbound", from: "+14045550123", to: "+14045550199", durationSeconds: 75 }),
    delayMs: 70,
  },
  { match: /\/deals\/service-areas\/resolve$/, method: "POST", reply: () => area, delayMs: 30 },
  {
    match: /\/deals\/qualified-techs$/,
    reply: () => [{ id: "t1", firstName: "Bo", lastName: "Diaz", eligible: true, reasons: [], jobTypeIds: [], serviceAreaIds: ["sa-1"] }],
    delayMs: 30,
  },
  // An unknown caller's number: the client book's search has nobody yet, but
  // the number already belongs to a client.
  { match: /\/search$/, reply: () => ({ hits: [], total: 0 }), delayMs: 30 },
  { match: /\/crm\/contacts\/search\/by-phone$/, reply: () => contact, delayMs: 60 },
];

let server: FakeServer;

/** The form is up: its Create button is on screen. */
const formIsUp = () => !!screen.queryByRole("button", { name: "Create" });

/** The cards in the order they stand on the page (their titles, without the Scheduled clock). */
const cardTitles = () =>
  Array.from(document.querySelectorAll("form section[data-slot=wz-card] h5")).map((el) =>
    el.firstChild?.textContent?.trim(),
  );

function watchFormFirstFrame() {
  return watchFirstFrame(formIsUp, () => ({
    requestsSoFar: server.requests.length,
    cards: cardTitles(),
    companyLoading: screen.queryAllByText(/Loading/).length > 0,
    customFieldShown: screen.queryAllByRole("textbox", { name: "Gate code" }).length > 0,
    clientName: screen.queryAllByDisplayValue("Ivy Quill").length > 0,
    street: screen.queryAllByDisplayValue("12 Birch Ln").length > 0,
    area: screen.queryAllByText("North Metro").length > 0,
    detecting: screen.queryAllByText(/detecting/i).length > 0,
    findingTechs: screen.queryAllByText(/finding technicians/i).length > 0,
    techSummary: screen.queryAllByText(/can perform/i).length > 0,
    callLoading: screen.queryAllByText(/loading the call/i).length > 0,
    skeletons: skeletonCount(),
  }));
}

const { NewDealPage } = await import("./new-deal-page");

beforeEach(() => {
  nav.params = "";
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NewDealPage — one load, not waves", () => {
  it("shows the form only once its catalogs are in — the cards in their final order", async () => {
    const watch = watchFormFirstFrame();
    renderWithClient(<NewDealPage />);
    await screen.findByRole("button", { name: "Create" }, { timeout: 3000 });
    watch.stop();

    const first = watch.frame()!;
    // The custom-field card is there from the first frame, after Workiz's four.
    expect(first.cards).toEqual(["Client Details", "Service Location", "Job Details", "Scheduled", "Access"]);
    expect(first).toMatchObject({ companyLoading: false, customFieldShown: true, skeletons: 0 });
  });

  it("opened from a call: the caller, their area, the team and the call are all there in the first frame", async () => {
    nav.params = "contactId=c1&callSid=CA1";
    const watch = watchFormFirstFrame();
    renderWithClient(<NewDealPage />);
    await screen.findByRole("button", { name: "Create" }, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toMatchObject({
      clientName: true,
      street: true,
      area: true,
      detecting: false,
      findingTechs: false,
      techSummary: true,
      callLoading: false,
      skeletons: 0,
    });
  });

  it("asks for nothing the form shows once it is up, and for each thing once", async () => {
    nav.params = "contactId=c1&callSid=CA1";
    const watch = watchFormFirstFrame();
    renderWithClient(<NewDealPage />);
    await screen.findByRole("button", { name: "Create" }, { timeout: 3000 });
    watch.stop();
    await settle();

    // The team directory may still be on its way: it names technicians only
    // once somebody picks one, so nothing on screen waits for it.
    const after = server.requests.slice(watch.frame()!.requestsSoFar).filter((r) => !r.startsWith("/users?"));
    expect(after).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("opened for an unknown caller: the new-client card says whose number it is from the first frame", async () => {
    nav.params = "callSid=CA1&phone=%2B14045550123";
    const watch = watchFirstFrame(formIsUp, () => ({
      draft: screen.queryAllByDisplayValue("(404) 555-0123").length > 0,
      owner: !!screen.queryByText(/a client already has this phone/i),
    }));
    renderWithClient(<NewDealPage />);
    await screen.findByRole("button", { name: "Create" }, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ draft: true, owner: true });
  });

  it("once shown, the form never goes back to a skeleton", async () => {
    nav.params = "contactId=c1&callSid=CA1";
    const { client } = renderWithClient(<NewDealPage />);
    await screen.findByRole("button", { name: "Create" }, { timeout: 3000 });

    let lost = false;
    const observer = new MutationObserver(() => {
      if (!formIsUp()) lost = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await client.invalidateQueries();
    await settle();
    observer.disconnect();

    expect(lost).toBe(false);
  });

  it("a request that fails does not hold the form off the screen", async () => {
    server.fail(/\/deals\/custom-fields$/);
    renderWithClient(<NewDealPage />);

    expect(await screen.findByRole("button", { name: "Create" }, { timeout: 3000 })).toBeInTheDocument();
  });
});
