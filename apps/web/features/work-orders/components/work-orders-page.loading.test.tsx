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

const pageUp = () => !!screen.queryByText("No access") || !!screen.queryByText("WO-100") || !!screen.queryByText("No work orders.");

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
