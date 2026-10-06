import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { ClientType, DealPriority, DealStatus, JobSuperStatus, type Deal } from "@bitcrm/types";
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
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CallRecord } from "../lib";

/**
 * A call's page appears once, whole.
 *
 * It said "No access" until the permissions came, then drew the call and let
 * each block finish on its own: the teammate's role badge, the call-tag
 * chips, the linked job (a spinner, then a taller line that pushed the
 * sections below it down), and the job's type a beat after that. The closed
 * "Link to job" dialog meanwhile read every open job in the workspace —
 * four lists, page after page — for a list nobody had opened.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/calls/CA1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const perms = vi.hoisted(() => ({ isLoading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: () => !perms.isLoading,
    isTechnician: false,
    isLoading: perms.isLoading,
    me: { id: "u-disp" },
  }),
}));
vi.mock("../use-call-stream", () => ({ useCallStream: () => undefined }));

const theCall: CallRecord = {
  callSid: "CA1",
  direction: "inbound",
  from: "+14045551001",
  to: "+14045550100",
  status: "completed",
  startedAt: "2026-10-01T10:00:00.000Z",
  answeredAt: "2026-10-01T10:00:05.000Z",
  endedAt: "2026-10-01T10:01:05.000Z",
  updatedAt: "2026-10-01T10:01:05.000Z",
  durationSeconds: 60,
  fromParty: { kind: "contact", id: "c1", name: "Jane Roe" },
  toParty: { kind: "user", id: "u1", name: "Sam Agent", roleId: "r-desk" },
  dealId: "d1",
  tagIds: ["ct-1"],
};

const deal: Deal = {
  id: "d1",
  dealNumber: "1042",
  contactId: "c1",
  clientType: ClientType.RESIDENTIAL,
  serviceArea: "North",
  address: { street: "1 Main", city: "Marietta", state: "GA", zip: "30060" },
  jobTypeId: "jt-lockout",
  superStatus: JobSuperStatus.SUBMITTED,
  assignedDispatcherId: "u-disp",
  priority: DealPriority.NORMAL,
  assignedTechIds: [],
  tagIds: [],
  status: DealStatus.ACTIVE,
  createdBy: "u-disp",
  createdAt: "",
  updatedAt: "",
};

const routes: FakeRoute[] = [
  { match: /\/telephony\/calls\/CA1$/, reply: () => theCall },
  // Everything around the call answers after it.
  { match: /\/users\/roles$/, reply: () => [{ id: "r-desk", name: "Front desk" }], delayMs: 60 },
  { match: /\/telephony\/call-tags$/, reply: () => [{ id: "ct-1", name: "Spam caller", color: "red", active: true }], delayMs: 50 },
  { match: /\/deals\/d1$/, reply: () => deal, delayMs: 70 },
  { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-lockout", name: "Lockout", active: true }], delayMs: 90 },
  { match: /\/deals$/, raw: true, reply: () => ({ success: true, data: [], pagination: {} }) },
];

let server: FakeServer;

const { CallDetailPage } = await import("./call-detail-page");

const renderPage = () =>
  renderWithClient(
    <TooltipProvider>
      <CallDetailPage callId="CA1" />
    </TooltipProvider>,
  );

const pageUp = () => !!screen.queryByRole("heading", { level: 1, name: "Jane Roe" });

beforeEach(() => {
  perms.isLoading = false;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CallDetailPage — no jumping", () => {
  it("draws the call with its role, tags and job in one frame", async () => {
    const watch = watchFirstFrame(pageUp, () => ({
      role: !!screen.queryByText("Front desk"),
      callTag: !!screen.queryByText("Spam caller"),
      job: !!screen.queryByText("#1042 — Lockout"),
      spinners: document.querySelectorAll(".animate-spin").length,
      placeholders: document.querySelectorAll(".animate-pulse.bg-muted").length,
      skeletons: skeletonCount(),
    }));
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Jane Roe" }, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ role: true, callTag: true, job: true, spinners: 0, placeholders: 0, skeletons: 0 });
  });

  it("waits for the permissions instead of saying No access", async () => {
    perms.isLoading = true;
    renderPage();
    await settle(50);

    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(skeletonCount()).toBeGreaterThan(0);
  });

  it("asks for each thing once, and nothing for the dialogs that are closed", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Jane Roe" }, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
    expect(server.requests.filter((r) => /\/deals\?/.test(r))).toEqual([]);
  });
});
