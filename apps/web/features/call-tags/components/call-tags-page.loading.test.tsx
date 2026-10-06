import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  type FakeServer,
} from "@/test/page-load";

/**
 * Settings → Call tags does not flash "No access" while the permissions are
 * still on their way, and asks for its catalog once.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/call-tags",
  useSearchParams: () => new URLSearchParams(),
}));
const perms = vi.hoisted(() => ({ isLoading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: () => !perms.isLoading,
    isTechnician: false,
    isLoading: perms.isLoading,
    me: perms.isLoading ? undefined : { id: "me" },
  }),
}));

let server: FakeServer;

const { CallTagsPage } = await import("./call-tags-page");

beforeEach(() => {
  perms.isLoading = false;
  server = installFakeServer([
    { match: /\/telephony\/call-tags$/, reply: () => [{ id: "ct-1", name: "Spam caller", color: "red", active: true, priority: 0 }] },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CallTagsPage — no jumping", () => {
  it("waits for the permissions instead of saying No access", async () => {
    perms.isLoading = true;
    renderWithClient(<CallTagsPage />);
    await settle(30);

    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(skeletonCount()).toBeGreaterThan(0);
  });

  it("asks for the catalog once", async () => {
    renderWithClient(<CallTagsPage />);
    await screen.findByText("Spam caller", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
