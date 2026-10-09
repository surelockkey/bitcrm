import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { JobSuperStatus, type JobsReportPage as ReportPage } from "@bitcrm/types";
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
 * The Jobs report does not jump.
 *
 * A browser that remembers its "By:" asks for the report without waiting for
 * the account's settings — and drew it with the default columns, then
 * redrew it with the account's own (here: Email instead of Phone, and no
 * Tags) when the settings came: every column slid. Now the table waits for
 * the columns it is drawn with, and comes once.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

const page: ReportPage = {
  rows: [
    {
      id: "d1",
      jobNumber: "AB12CD",
      contactId: "c1",
      client: "Test Client",
      tags: [],
      type: "Lockout",
      createdAt: "2026-10-06T14:00:00.000Z",
      phone: "+15555550100",
      email: "client@example.test",
      superStatus: JobSuperStatus.SUBMITTED,
      status: "Submitted",
      techIds: [],
      tech: [],
      createdBy: "Ann Lee",
      origin: "new",
    },
  ],
  pagination: { page: 1, pageSize: 50, total: 1, pages: 1, from: 1, to: 1 },
  window: { by: "created", from: "2026-10-05", to: "2026-10-06" },
  sort: { column: "created", dir: "desc" },
  money: true,
};

const empty = { success: true, data: [], pagination: {} };
const routes: FakeRoute[] = [
  { match: /\/deals\/report$/, reply: () => page, delayMs: 30 },
  // The account's own columns, a beat after the report.
  { match: /\/deals\/report\/settings$/, reply: () => ({ columns: ["jobNumber", "client", "email", "status"], by: "end" }), delayMs: 90 },
  { match: /\/deals\/job-statuses$/, reply: () => [] },
  { match: /\/deals\/job-tags$/, reply: () => [] },
  { match: /\/deals\/job-types$/, reply: () => [] },
  { match: /\/deals\/job-sources$/, reply: () => [] },
  { match: /\/deals\/service-areas$/, reply: () => [] },
  { match: /\/deals\/external-companies$/, reply: () => [] },
  { match: /\/users\/technicians$/, raw: true, reply: () => empty },
  { match: /\/users$/, raw: true, reply: () => empty },
];

let server: FakeServer;

const { JobsReportPage } = await import("./jobs-report-page");

const tableUp = () => !!screen.queryByText("AB12CD");
const heads = () => [...document.querySelectorAll("[data-slot=wz-scroll-grid-head] th")].map((th) => th.textContent?.trim() ?? "");

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("JobsReportPage — no jumping", () => {
  it("draws the table with the account's columns from its first frame", async () => {
    // This browser picked "By: Job created" before: the report need not wait for the settings to ask.
    window.localStorage.setItem("bitcrm.jobs-report.by", "created");
    const watch = watchFirstFrame(tableUp, () => ({ heads: heads(), skeletons: skeletonCount() }));
    renderWithClient(<JobsReportPage today="2026-10-06" />);
    await screen.findByText("AB12CD", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ heads: ["Job #", "Client", "Email", "Status"], skeletons: 0 });
  });

  it("without a remembered By:, asks with the account's and draws its columns at once", async () => {
    const watch = watchFirstFrame(tableUp, () => ({ heads: heads(), skeletons: skeletonCount() }));
    renderWithClient(<JobsReportPage today="2026-10-06" />);
    await screen.findByText("AB12CD", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    expect(watch.frame()).toEqual({ heads: ["Job #", "Client", "Email", "Status"], skeletons: 0 });
    const asked = server.requests.filter((r) => r.startsWith("/api/deals/report?"));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("by=end");
  });

  it("asks for each thing once", async () => {
    renderWithClient(<JobsReportPage today="2026-10-06" />);
    await screen.findByText("AB12CD", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
