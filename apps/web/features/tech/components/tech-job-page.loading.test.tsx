import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { ClientType, DealPriority, DealStatus, JobSuperStatus } from "@bitcrm/types";
import type { Deal } from "@bitcrm/types";
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
 * The technician's job page appears once, whole.
 *
 * It used to come up the moment the job did and fill in after: the client's
 * name replaced "—", the number and the Call button pushed the job note down,
 * the job type read "Unknown type", and the photo count changed its mind.
 *
 * Technician-only, so the browser audit never saw it; this renders the real
 * page against a fake server and looks at the very first frame it shows.
 */

/**
 * With the app's own query defaults (app/providers.tsx): an answer is fresh
 * for 30 s, so the photo block that mounts with the page reads the files the
 * page asked for a moment earlier instead of asking again — as in the browser.
 */
function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
  });
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) };
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
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
  usePermissions: () => ({ can: () => true, isTechnician: true, isLoading: false, me: { id: "t1" } }),
}));

const job: Deal = {
  id: "d1",
  dealNumber: "9042",
  contactId: "c1",
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "North",
  address: { street: "4 Elm St", city: "Testville", state: "GA", zip: "30001" },
  jobTypeId: "jt-lockout",
  superStatus: JobSuperStatus.IN_PROGRESS,
  subStatusId: "st-onsite",
  assignedDispatcherId: "u-disp",
  priority: DealPriority.NORMAL,
  assignedTechIds: ["t1"],
  tagIds: [],
  status: DealStatus.ACTIVE,
  createdBy: "u-disp",
  createdAt: "",
  updatedAt: "",
  scheduledDate: "2026-10-06",
  scheduledTimeSlot: "09:00-11:00",
  notes: "Side gate, dog in the yard.",
};

const routes: FakeRoute[] = [
  { match: /\/deals\/d1$/, reply: () => job, delayMs: 20 },
  {
    match: /\/crm\/contacts\/c1$/,
    reply: () => ({ id: "c1", firstName: "Ivy", lastName: "Quill", phones: ["+14045550123"], emails: [], addresses: [] }),
    delayMs: 40,
  },
  {
    match: /\/deals\/d1\/attachments$/,
    reply: () => [{ id: "a1", dealId: "d1", fileName: "door.jpg", contentType: "image/jpeg", size: 1000 }],
    delayMs: 60,
  },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true, priority: 1 }], delayMs: 50 },
  { match: /\/deals\/job-statuses$/, reply: () => [{ id: "st-onsite", name: "On site", active: true, priority: 1 }], delayMs: 50 },
];

let server: FakeServer;

/** The job is up: its number is on screen. */
const jobIsUp = () => !!screen.queryByText("#9042");

function watchJobFirstFrame() {
  return watchFirstFrame(jobIsUp, () => ({
    requestsSoFar: server.requests.length,
    client: !!screen.queryByRole("heading", { name: "Ivy Quill" }),
    phone: !!screen.queryByText("(404) 555-0123"),
    callButton: screen.queryAllByRole("button", { name: /call/i }).length > 0,
    jobType: !!screen.queryByText(/Lockout/),
    subStatus: !!screen.queryByText(/On site/),
    photos: !!screen.queryByText("1 photo on this job."),
    skeletons: skeletonCount(),
  }));
}

const { TechJobPage } = await import("./tech-job-page");

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TechJobPage — one load, not waves", () => {
  it("shows the job only once its client, its names and its photos are in", async () => {
    const watch = watchJobFirstFrame();
    renderWithClient(<TechJobPage dealId="d1" />);
    await screen.findByText("#9042", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toMatchObject({
      client: true,
      phone: true,
      callButton: true,
      jobType: true,
      subStatus: true,
      photos: true,
      skeletons: 0,
    });
  });

  it("asks for nothing more once the job is on screen, and for each thing once", async () => {
    const watch = watchJobFirstFrame();
    renderWithClient(<TechJobPage dealId="d1" />);
    await screen.findByText("#9042", {}, { timeout: 3000 });
    watch.stop();
    await settle();

    expect(server.requests.slice(watch.frame()!.requestsSoFar)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("once shown, the job never goes back to the skeleton", async () => {
    const { client } = renderWithClient(<TechJobPage dealId="d1" />);
    await screen.findByText("#9042", {}, { timeout: 3000 });

    let lost = false;
    const observer = new MutationObserver(() => {
      if (!jobIsUp()) lost = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    await client.invalidateQueries();
    await settle();
    observer.disconnect();

    expect(lost).toBe(false);
  });

  it("a job that cannot be read says so rather than waiting forever", async () => {
    server.fail(/\/deals\/d1$/);
    renderWithClient(<TechJobPage dealId="d1" />);

    expect(await screen.findByText("Job not found", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it("a request that fails does not hold the job off the screen", async () => {
    server.fail(/\/deals\/d1\/attachments$/);
    renderWithClient(<TechJobPage dealId="d1" />);

    expect(await screen.findByText("#9042", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
