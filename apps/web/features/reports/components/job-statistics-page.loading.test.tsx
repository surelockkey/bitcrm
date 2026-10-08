import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { JobStatistics } from "@bitcrm/types";
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
 * Job Statistics does not jump.
 *
 * The filter bar and the loading block were drawn at once; the tags row came
 * a moment later, between them, and pushed the loading block down by its own
 * height (CLS 0.19 on the audit) — and the area select widened when its
 * areas came. Now the filters, the tags and the figures come in one frame,
 * and another period keeps the figures on screen until the new ones are in.
 */

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

const stats = (done: number): JobStatistics => ({
  window: { by: "end", from: "2026-10-01", to: "2026-10-06" },
  access: { money: false, profit: false, tabs: [] },
  kpis: {
    all: 10,
    done,
    open: 4,
    canceled: 1,
    canceledPct: 10,
    submitted: 3,
    inProgress: 1,
    pending: 0,
    donePendingApproval: 0,
  },
  series: [{ date: "2026-10-01", jobs: 10, canceled: 1, done }],
  warnings: [],
});

const routes: FakeRoute[] = [
  // "Created" is another count on the server.
  {
    match: /\/deals\/report\/statistics$/,
    reply: (url) => stats(url.searchParams.get("by") === "created" ? 777 : 5),
    delayMs: 80,
  },
  { match: /\/deals\/service-areas$/, reply: () => [{ id: "sa-1", name: "North", active: true, priority: 0 }], delayMs: 20 },
  // The tags land between the filter bar and the figures, as on dev.
  { match: /\/deals\/job-tags$/, reply: () => [{ id: "tag-1", name: "VIP", active: true, priority: 0 }], delayMs: 40 },
];

let server: FakeServer;

const { JobStatisticsPage } = await import("./job-statistics-page");

const areaSelect = () => screen.queryByRole("combobox", { name: "Service area" });
// Workiz's tag cloud: every tag a chip over the report.
const tagChips = () => !!screen.queryByRole("button", { name: "VIP" });
const kpisUp = () => !!screen.queryByText("Jobs Done");
const loadingBlock = () => document.querySelector('[role="status"][aria-label="Loading report"]');

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("JobStatisticsPage — no jumping", () => {
  it("draws the filters, the tags and the figures in one frame", async () => {
    const watch = watchFirstFrame(
      () => !!areaSelect() || kpisUp(),
      () => ({
        kpis: kpisUp(),
        areas: !!areaSelect(),
        tags: tagChips(),
        skeletons: skeletonCount(),
      }),
    );
    renderWithClient(<JobStatisticsPage today="2026-10-06" />);
    await screen.findByText("Jobs Done", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ kpis: true, areas: true, tags: true, skeletons: 0 });
  });

  it("never puts anything above the loading block once it is drawn", async () => {
    let above: number | null = null;
    let moved = false;
    const observer = new MutationObserver(() => {
      const block = loadingBlock();
      if (!block) return;
      let n = 0;
      for (let el = block.previousElementSibling; el; el = el.previousElementSibling) n++;
      if (above === null) above = n;
      else if (n !== above) moved = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    renderWithClient(<JobStatisticsPage today="2026-10-06" />);
    await screen.findByText("Jobs Done", {}, { timeout: 3000 });
    await settle();
    observer.disconnect();

    expect(moved).toBe(false);
  });

  it("keeps the figures on screen while another count loads", async () => {
    renderWithClient(<JobStatisticsPage today="2026-10-06" />);
    await screen.findByText("Jobs Done", {}, { timeout: 3000 });
    await settle();

    let blanked = false;
    const observer = new MutationObserver(() => {
      if (skeletonCount() > 0 || !kpisUp() || !tagChips()) blanked = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    fireEvent.click(screen.getByRole("radio", { name: "Created" }));
    await screen.findByText("777", {}, { timeout: 3000 });
    observer.disconnect();

    expect(blanked).toBe(false);
  });

  it("asks for each thing once", async () => {
    renderWithClient(<JobStatisticsPage today="2026-10-06" />);
    await screen.findByText("Jobs Done", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
