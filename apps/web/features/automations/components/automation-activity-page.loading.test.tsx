import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { AutomationRun } from "@bitcrm/types";
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
 * The automation activity feed does not jump.
 *
 * The firings came first and the rules after them, so every row said
 * "Rule 1a2b3c4d" until the names arrived and rewrote it; the "of N" under
 * the list came on its own beat after that.
 *
 * Now the rows land named, with the number under them, in one frame.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/automations/activity",
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
  usePermissions: () => ({ can: () => true, isTechnician: false, isLoading: false, me: { id: "me" } }),
}));

const run = (id: string, ruleId: string): AutomationRun => ({
  id,
  ruleId,
  firedAt: "2026-10-05T15:04:00.000Z",
  trigger: "deal.status_changed",
  entity: "deal:d-1",
  occurrence: "o",
  outcome: "sent",
  actions: [{ type: "send_sms", to: "Ann (tech)", outcome: "sent", body: "The job was canceled." }],
});

const routes: FakeRoute[] = [
  { match: /\/messaging\/automations\/runs$/, reply: () => ({ items: [run("r-1", "rule-1"), run("r-2", "rule-1")] }) },
  // The names and the number answer after the firings — well after: drawing
  // the feed in jsdom takes a few hundred milliseconds, and an answer due
  // inside that lands in the same frame and would hide the wave.
  {
    match: /\/messaging\/automations$/,
    reply: () => [{ id: "rule-1", name: "Canceled job & techs", enabled: true, createdAt: "", updatedAt: "" }],
    delayMs: 600,
  },
  { match: /\/messaging\/automations\/runs\/count$/, reply: () => ({ total: 2, atLeast: false }), delayMs: 700 },
];

let server: FakeServer;

const { AutomationActivityPage } = await import("./automation-activity-page");

const rowsUp = () => !!document.querySelector('[data-testid="activity-r-1"]');

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AutomationActivityPage — no jumping", () => {
  it("draws the firings named, with the number under them, in one frame", async () => {
    const watch = watchFirstFrame(rowsUp, () => ({
      named: screen.queryAllByText("Canceled job & techs").length > 0,
      total: /of 2/.test(screen.queryByTestId("list-pagination")?.textContent ?? ""),
      skeletons: skeletonCount(),
    }));
    renderWithClient(<AutomationActivityPage />);
    await screen.findByTestId("activity-r-1", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ named: true, total: true, skeletons: 0 });
  });

  it("asks for each thing once", async () => {
    renderWithClient(<AutomationActivityPage />);
    await screen.findByTestId("activity-r-1", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
