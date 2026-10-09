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

/**
 * Phone → Devices comes in once, whole: one skeleton while the permissions
 * and the catalog come, then the grid with every device named — and on an
 * API from before Devices, the empty grid rather than a skeleton that never
 * goes.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/calls/devices",
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

const routes: FakeRoute[] = [
  {
    match: /\/telephony\/devices$/,
    reply: () => [{ id: "d-ct", name: "SURE CT LOCKSMITH", number: "+12039893585", type: "shop_line", active: true }],
    delayMs: 60,
  },
];

let server: FakeServer;
const { CallDevicesPage } = await import("./call-devices-page");

beforeEach(() => {
  perms.isLoading = false;
  server = installFakeServer(routes);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CallDevicesPage — no jumping", () => {
  it("waits for the permissions instead of saying No access", async () => {
    perms.isLoading = true;
    renderWithClient(<CallDevicesPage />);
    await settle(30);
    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(skeletonCount()).toBeGreaterThan(0);
  });

  it("draws each device with its number and the Add device pill in the first frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("SURE CT LOCKSMITH"),
      () => ({
        number: !!screen.queryByText("(203) 989-3585"),
        add: !!screen.queryByRole("button", { name: "Add device" }),
        skeletons: skeletonCount(),
      }),
    );
    renderWithClient(<CallDevicesPage />);
    await screen.findByText("SURE CT LOCKSMITH", {}, { timeout: 3000 });
    watch.stop();
    expect(watch.frame()).toEqual({ number: true, add: true, skeletons: 0 });
  });

  it("asks for the catalog once", async () => {
    renderWithClient(<CallDevicesPage />);
    await screen.findByText("SURE CT LOCKSMITH", {}, { timeout: 3000 });
    await settle();
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("shows the empty grid on an API that has no Devices yet", async () => {
    server = installFakeServer([
      { match: /\/telephony\/devices$/, reply: () => ({ success: false, message: "Cannot GET" }), raw: true, status: 404 },
    ]);
    renderWithClient(<CallDevicesPage />);
    expect(await screen.findByText("No devices added", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(skeletonCount()).toBe(0);
  });
});
