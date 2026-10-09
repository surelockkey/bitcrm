import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
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

/**
 * Phone → Blocked callers does not jump: no "No access" while the permissions
 * come, then the grid whole — its rows and its pager in the same frame, one
 * request for the list.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/calls/blocked-callers",
  useSearchParams: () => new URLSearchParams(),
}));
const perms = vi.hoisted(() => ({ isLoading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string) => !perms.isLoading && !resource,
  usePermissions: () => ({
    can: () => !perms.isLoading,
    isTechnician: false,
    isLoading: perms.isLoading,
    me: perms.isLoading ? undefined : { id: "me" },
  }),
}));

const rows = [
  { id: "b1", number: "+12147917112", comment: "sales calls", createdBy: "u", createdAt: "2020-07-29T20:50:18.000Z" },
  { id: "b2", number: "+12037601092", createdBy: "u", createdAt: "2021-07-21T14:06:59.000Z" },
];

const routes: FakeRoute[] = [{ match: /\/telephony\/blocked-callers$/, reply: () => rows }];

let server: FakeServer;

const { BlockedCallersPage } = await import("./blocked-callers-page");

const renderPage = () =>
  renderWithClient(
    <TooltipProvider>
      <BlockedCallersPage />
    </TooltipProvider>,
  );

beforeEach(() => {
  perms.isLoading = false;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Blocked callers — no jumping", () => {
  it("waits for the permissions instead of saying No access", async () => {
    perms.isLoading = true;
    renderPage();
    await settle(30);

    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(skeletonCount()).toBeGreaterThan(0);
  });

  it("shows the rows and the pager in the same first frame, with no skeleton left", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("(214) 791-7112"),
      () => ({ pager: screen.queryByTestId("list-pagination")?.textContent ?? null, skeletons: skeletonCount() }),
    );
    renderPage();
    await screen.findByText("(214) 791-7112", {}, { timeout: 3000 });
    watch.stop();

    const frame = watch.frame();
    expect(frame?.skeletons).toBe(0);
    expect(frame?.pager).toContain("Showing 1 to 2 of 2 results");
    expect(screen.getByText("2020-07-29")).toBeInTheDocument();
  });

  it("asks for the list once", async () => {
    renderPage();
    await screen.findByText("(214) 791-7112", {}, { timeout: 3000 });
    await settle(50);
    expect(duplicates(server.requests)).toEqual([]);
    expect(server.requests.filter((r) => r.includes("/telephony/blocked-callers"))).toHaveLength(1);
  });
});
