import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { CallTrackingReport } from "@bitcrm/types";
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
 * Call Tracking does not jump.
 *
 * The report was drawn the moment it came, whatever else was still on its
 * way: the ad groups' names (a catalog that is sometimes seconds slow) filled
 * the Ad group column in later and widened it, and with the role still being
 * read the Revenue card and column were left out, to be added a beat later.
 * Now the report comes with its names and its money in one frame, and another
 * graph step keeps it on screen until the new one is in.
 */

vi.mock("@/features/auth/use-permissions", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const useMe = () =>
    useQuery({ queryKey: ["me"], queryFn: () => fetch("/api/users/me").then((r) => r.json()), staleTime: Infinity });
  return {
    useDenied: () => () => false,
    usePermissions: () => {
      const me = useMe();
      return { can: () => !me.isLoading, isLoading: me.isLoading };
    },
  };
});

const report = (graphBy: "hour" | "day"): CallTrackingReport => ({
  from: "2026-10-01",
  to: "2026-10-06",
  groupBy: "flows",
  graphBy,
  rows: [
    {
      key: "flow-1",
      name: "Main line",
      adGroupId: "src-1",
      calls: 40,
      callers: 30,
      completed: 35,
      missed: 5,
      avgDurationSeconds: 95,
      jobs: 12,
      leads: 3,
      jobsConversionRate: 30,
      leadsConversionRate: 7.5,
      revenue: 4800,
    },
  ],
  cards: { incomingCalls: 40, callers: 30, missedCalls: 5, topFlow: "Main line", avgDurationSeconds: 95, conversion: 30, revenue: 4800 },
  graph: { graphBy, buckets: graphBy === "hour" ? ["09", "10"] : ["2026-10-01", "2026-10-02"], series: [{ name: "Main line", counts: [10, 30] }] },
  atLeast: false,
  computedAt: "2026-10-06T07:00:00.000Z",
});

const routes: FakeRoute[] = [
  // The report first; the role and the ad groups after it.
  { match: /\/telephony\/calls\/stats\/tracking$/, reply: (url) => report(url.searchParams.get("graphBy") === "day" ? "day" : "hour"), delayMs: 40 },
  { match: /\/users\/me$/, raw: true, reply: () => ({ id: "u-office" }), delayMs: 70 },
  { match: /\/deals\/job-sources$/, reply: () => [{ id: "src-1", name: "Google Ads" }], delayMs: 110 },
];

let server: FakeServer;

const { CallTrackingPage } = await import("./call-tracking-page");

const reportUp = () => !!document.querySelector('[role="group"][aria-label="Report totals"]');

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CallTrackingPage — no jumping", () => {
  it("draws the report with its ad groups and its revenue in one frame", async () => {
    const watch = watchFirstFrame(reportUp, () => ({
      adGroup: !!screen.queryByText("Google Ads"),
      revenueCard: !!document.querySelector('[aria-label="Report totals"] [aria-label="Revenue"]'),
      revenueColumn: !!screen.queryByRole("button", { name: "Sort by Revenue" }),
      skeletons: skeletonCount(),
    }));
    renderWithClient(<CallTrackingPage today="2026-10-06" />);
    await screen.findByText("Google Ads", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ adGroup: true, revenueCard: true, revenueColumn: true, skeletons: 0 });
  });

  it("keeps the report on screen while another graph step loads", async () => {
    renderWithClient(<CallTrackingPage today="2026-10-06" />);
    await screen.findByText("Google Ads", {}, { timeout: 3000 });
    await settle();

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0 || !reportUp()) blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    fireEvent.click(screen.getByRole("radio", { name: "day" }));
    await vi.waitFor(() => expect(server.requests.some((r) => r.includes("graphBy=day"))).toBe(true));
    await settle();
    observer.disconnect();

    expect(blanked).toBe(false);
  });

  it("asks for each thing once", async () => {
    renderWithClient(<CallTrackingPage today="2026-10-06" />);
    await screen.findByText("Google Ads", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
