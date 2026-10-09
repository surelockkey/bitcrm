import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import type { Deal } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeServer,
} from "@/test/page-load";
import { techJob, techJobRoutes } from "./tech-job-page.fixtures";

/**
 * The technician's job page appears once, whole — the job page's own rule
 * (deal-detail-page.loading.test.tsx), with the visit row in the same frame:
 * the client, the team's names, the dial-in, the tab bar's lines and the
 * Visit pills are all there the first time the job is.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/my-jobs/d1",
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
    can: (resource: string, action?: string) =>
      !(resource === "deals" && (action === "create" || action === "delete")) && resource !== "users" && resource !== "settings",
    isTechnician: true,
    isLoading: false,
    me: { id: "t1", firstName: "Tess", lastName: "Tech" },
  }),
}));
vi.mock("@/features/calls/components/live-call-strip", () => ({ LiveCallStrip: () => null }));

let server: FakeServer;
let client: QueryClient;
let currentDeal: Deal = techJob;

const jobIsUp = () => !!document.body.textContent?.includes("#1042");

function watchJobFirstFrame() {
  return watchFirstFrame(jobIsUp, () => ({
    requestsSoFar: server.requests.length,
    clientName: !!screen.queryByDisplayValue("Jane"),
    techName: !!screen.queryByText("Tess Tech"),
    dialIn: !!screen.queryByText(/#8707/),
    jobTypeLine: !!screen.queryByText("Lockout", { selector: "#job-tab-details-sub" }),
    estimatesLine: !!screen.queryByText("0 estimates"),
    visit: !!screen.queryByRole("button", { name: /^Confirm receipt/ }),
    skeletons: skeletonCount(),
  }));
}

const { TechJobPage } = await import("./tech-job-page");

function renderPage() {
  ({ client } = renderWithClient(<TechJobPage dealId="d1" />));
}

beforeEach(() => {
  currentDeal = techJob;
  server = installFakeServer(techJobRoutes(() => currentDeal));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TechJobPage — one load", () => {
  it("shows the job, its visit row and everything on it in one frame", async () => {
    const watch = watchJobFirstFrame();
    renderPage();
    expect(skeletonCount()).toBeGreaterThan(0);
    await screen.findByText("#1042", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toMatchObject({
      clientName: true,
      techName: true,
      dialIn: true,
      jobTypeLine: true,
      estimatesLine: true,
      visit: true,
      skeletons: 0,
    });
  });

  it("asks for nothing more once the job is on screen, and for each thing once", async () => {
    const watch = watchJobFirstFrame();
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });
    watch.stop();
    await settle();

    const asked = watch.frame()!.requestsSoFar;
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("once shown, a job that comes back changed never goes back to the skeleton", async () => {
    renderPage();
    await screen.findByText("#1042", {}, { timeout: 3000 });

    let lost = false;
    const observer = new MutationObserver(() => {
      if (!document.body.textContent?.includes("#1042")) lost = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    currentDeal = { ...techJob, arrivedAt: "2026-10-09T13:40:00.000Z" };
    await client.invalidateQueries();
    await settle();
    observer.disconnect();

    expect(lost).toBe(false);
  });

  it("a request that fails does not hold the job off the screen", async () => {
    server.fail(/\/deals\/qualified-techs$/);
    renderPage();

    expect(await screen.findByText("#1042", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});
