import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { PaymentReportRow } from "@bitcrm/types";
import {
  declaredRowHeights,
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  watchLoadingRowHeights,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";

/**
 * The Payments report does not jump.
 *
 * It opened on "No access" — the permissions had not answered yet, and a
 * permission not yet known read as a refusal — then grey bars, then the
 * report; the tiles grew a "N payments" line when it came and pushed the
 * filters and the table down. Now the first frame is the report itself:
 * the cards, the rows, the technician's Workiz name and the client's phone
 * under the name (fetched for the page's clients before it shows).
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const row: PaymentReportRow = {
  id: "p1",
  kind: "payment",
  paymentId: "p1",
  dealId: "d1",
  dealNumber: "6563K8",
  at: "2026-10-02T16:00:00.000Z",
  amount: 1064.44,
  tip: 134.8,
  type: "charge",
  typeLabel: "Credit charge",
  status: "succeeded",
  contactId: "c1",
  clientName: "Jane Doe",
  technicianId: "t1",
  technicianName: "Tom Tech",
  jobTypeName: "Lockout",
};

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  {
    match: /\/billing\/payments\/report$/,
    reply: () => ({ items: [row], totals: { count: 1, amount: 1064.44, tips: 134.8, serviceFees: 0, byType: {} } }),
    delayMs: 60,
  },
  // The filter's options: the technicians and the service areas.
  { match: /\/users$/, raw: true, reply: () => ({ success: true, data: [{ id: "t1", firstName: "Tom", lastName: "Tech" }], pagination: {} }) },
  { match: /\/deals\/service-areas$/, reply: () => [{ id: "a1", name: "North", active: true }] },
  // The filter's team, in Workiz's order.
  { match: /\/technicians$/, raw: true, reply: () => ({ success: true, data: [{ userId: "t1", createdAt: "2020-01-01T00:00:00.000Z" }], pagination: {} }) },
  // The page's clients, for the phone under each name.
  {
    match: /\/crm\/contacts\/by-ids$/,
    reply: () => [{ id: "c1", firstName: "Jane", lastName: "Doe", phones: ["4695000793"], emails: [] }],
    delayMs: 40,
  },
];

let server: FakeServer;

const { PaymentsReportPage } = await import("./payments-report-page");

const pageUp = () =>
  !!screen.queryByText("Total amount") || !!screen.queryByText("No access") || !!screen.queryByText("6563K8 (Job)");

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PaymentsReportPage — no jumping", () => {
  it("opens on the report, its tiles and rows in one frame — never on No access", async () => {
    const watch = watchFirstFrame(pageUp, () => ({
      noAccess: !!screen.queryByText("No access"),
      total: !!screen.queryByRole("group", { name: "Total amount" })?.textContent?.includes("$1,064.44"),
      row: !!screen.queryByText("6563K8 (Job)"),
      tech: !!screen.queryByText("Tom Tech"),
      phone: !!screen.queryByText("(469) 500-0793"),
      skeletons: skeletonCount(),
      asked: server.requests.length,
    }));
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)", {}, { timeout: 5000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({ noAccess: false, total: true, row: true, tech: true, phone: true, skeletons: 0 });
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  // probe_shift 2026-10-09 (CLS 0.06 left after the rows' height): the
  // shell was drawn without Amount and Tip while the permissions loaded, and
  // when they answered the two columns came in and the others narrowed. The
  // shell now guesses the money columns: its headers are the table's.
  it("draws the shell with the columns the table will have — Amount and Tip from the first frame", async () => {
    const headers = () => [...document.querySelectorAll('[data-slot="payments-report-grid"] thead th')].map((th) => th.textContent?.trim());
    const watch = watchFirstFrame(() => !!document.querySelector('[data-slot="payments-report-grid"]'), headers);
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)", {}, { timeout: 5000 });
    watch.stop();

    expect(watch.frame()).toEqual(expect.arrayContaining(["Amount", "Tip"]));
    expect(headers()).toEqual(watch.frame());
  });

  // app_audit 2026-10-09: CLS 0.07 — the shell's 56px blanks became Workiz's
  // 80px rows (the client's name over their phone, rep_payments) and the pager
  // went down with them. Blanks, records and filler now all declare the 80px.
  it("lands its rows on the shell's blank rows — the same declared row height before and after", async () => {
    const watch = watchLoadingRowHeights();
    renderWithClient(<PaymentsReportPage />);
    await screen.findByText("6563K8 (Job)", {}, { timeout: 5000 });
    watch.stop();

    expect(watch.frame()).toEqual(["80px"]);
    expect(declaredRowHeights()).toEqual(["80px"]);
  });
});
