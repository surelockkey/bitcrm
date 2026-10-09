import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { WorkOrder } from "@bitcrm/types";
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
 * The Work Orders page does not jump.
 *
 * It opened on "No access" — the permissions had not answered, and a
 * permission not yet known read as a refusal — then the rows came with "—"
 * for a client until the companies landed. Now the first frame is the
 * registry, the client of every row named.
 *
 * One work order (`?id=`) is the same: its client, the letterhead, the job's
 * number and the uploaded document are four requests after the work order
 * itself, and the first frame has all of them.
 */

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

const wo = (over: Partial<WorkOrder>): WorkOrder =>
  ({ id: "w1", woNumber: "WO-100", companyId: "co1", date: "2026-10-05", amount: 5000, status: "open", createdBy: "u1", createdAt: "", updatedAt: "", ...over }) as WorkOrder;

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  { match: /\/crm\/work-orders$/, reply: () => [wo({})], delayMs: 20 },
  // The companies name the rows' clients, and come last.
  {
    match: /\/crm\/companies$/,
    raw: true,
    reply: () => ({ success: true, data: [{ id: "co1", title: "Acme Supply", phones: [], emails: [] }], pagination: {} }),
    delayMs: 60,
  },
];

let server: FakeServer;

const { WorkOrdersPage } = await import("./work-orders-page");

const pageUp = () => !!screen.queryByText("No access") || !!screen.queryByText("WO-100") || !!screen.queryByText("No Records Found");

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkOrdersPage — no jumping", () => {
  it("opens on the registry with every client named — never on No access", async () => {
    const watch = watchFirstFrame(pageUp, () => ({
      noAccess: !!screen.queryByText("No access"),
      row: !!screen.queryByText("WO-100"),
      client: !!screen.queryByText("Acme Supply"),
      skeletons: skeletonCount(),
      asked: server.requests.length,
    }));
    renderWithClient(<WorkOrdersPage />);
    await screen.findByText("WO-100", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({ noAccess: false, row: true, client: true, skeletons: 0 });
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });
});

const oneRoutes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  { match: /\/crm\/work-orders\/w1$/, reply: () => wo({ dealId: "d1", s3Key: "work-orders/w1", description: "Rekey" }), delayMs: 20 },
  // Each of these can only be asked once the work order has answered — and each comes at its own beat.
  { match: /\/crm\/companies\/co1$/, reply: () => ({ id: "co1", title: "Acme Supply", phones: [], emails: [] }), delayMs: 60 },
  {
    match: /\/billing\/business-profiles$/,
    reply: () => [{ id: "bp-default", name: "Sure Lock & Key LLC", isDefault: true, active: true, defaultPaymentTerms: "cash", dueDateBasis: "invoice_created" }],
    delayMs: 40,
  },
  { match: /\/deals\/by-ids$/, reply: () => [{ id: "d1", dealNumber: "PK4399" }], delayMs: 50 },
  { match: /\/crm\/work-orders\/w1\/document$/, reply: () => ({ downloadUrl: "https://s3.test/w1.pdf" }), delayMs: 70 },
];

describe("WorkOrdersPage — one work order, no jumping", () => {
  it("opens with the client, the letterhead, the job and the document already in", async () => {
    server = installFakeServer(oneRoutes);
    const up = () => !!screen.queryByText("No access") || !!screen.queryByRole("heading", { name: /Work Order #/ });
    const watch = watchFirstFrame(up, () => ({
      noAccess: !!screen.queryByText("No access"),
      client: screen.queryAllByText("Acme Supply").length > 0,
      letterhead: !!screen.queryByText("Sure Lock & Key LLC"),
      job: !!screen.queryByText("PK4399"),
      document: !!screen.queryByTitle("Work order WO-100 document"),
      skeletons: skeletonCount(),
      asked: server.requests.length,
    }));
    renderWithClient(<WorkOrdersPage initialId="w1" />);
    await screen.findByRole("heading", { name: "Work Order #WO-100" }, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({ noAccess: false, client: true, letterhead: true, job: true, document: true, skeletons: 0 });
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });
});
