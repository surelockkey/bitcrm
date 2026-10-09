import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeServer,
} from "@/test/page-load";
import { adminMe, profileRoutes, techMe } from "./profile-page.fixtures";

/**
 * My Profile appears in place, as Workiz's user page: "User Settings" stands
 * where it will stay from the first frame, one skeleton holds the tabs and
 * the two columns, and then they come whole — a technician's onboarding
 * checklist, their job types and service areas named, all in that frame.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/profile",
}));
// A Google Places widget, not page data.
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value, id, ariaLabel }: { value: string; id?: string; ariaLabel?: string }) => (
    <input id={id} aria-label={ariaLabel} defaultValue={value} />
  ),
}));

let server: FakeServer;

const { ProfilePage } = await import("./profile-page");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const heading = () => screen.queryByRole("heading", { name: "User Settings" });

describe("ProfilePage — loading", () => {
  it("holds the heading in place from the first frame, and the account comes whole under it", async () => {
    server = installFakeServer(profileRoutes(adminMe, { me: 60 }));
    const loading = watchFirstFrame(
      () => skeletonCount() > 0 || !!heading(),
      () => ({ heading: heading(), skeletons: skeletonCount(), email: !!screen.queryByDisplayValue("ada@example.com") }),
    );
    const loaded = watchFirstFrame(
      () => !!screen.queryByDisplayValue("ada@example.com"),
      () => ({
        heading: heading(),
        skeletons: skeletonCount(),
        tabs: screen.queryAllByRole("tab").length,
        twoStep: !!screen.queryByRole("switch", { name: "Two-factor authentication" }),
      }),
    );

    renderWithClient(<ProfilePage />);
    await screen.findByDisplayValue("ada@example.com", {}, { timeout: 3000 });
    await settle();
    loading.stop();
    loaded.stop();

    expect(loading.frame()?.email).toBe(false);
    expect(loading.frame()?.skeletons).toBeGreaterThan(0);
    expect(loading.frame()?.heading).not.toBeNull();
    expect(loading.frame()?.heading).toBe(heading());
    expect(loaded.frame()).toEqual(expect.objectContaining({ skeletons: 0, tabs: 1, twoStep: true }));
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("brings a technician's form in one frame: onboarding, job types and areas named", async () => {
    server = installFakeServer(
      profileRoutes(techMe, { me: 10, profile: 20, assignments: 40, onboarding: 60, catalogs: 80 }),
    );
    const loaded = watchFirstFrame(
      () => !!screen.queryByRole("tab", { name: "Profile" }),
      () => ({
        skeletons: skeletonCount(),
        email: !!screen.queryByDisplayValue("theo@example.com"),
        onboarding: !!screen.queryByText(/1 of 3 steps done/),
        jobType: !!screen.queryByText("Rekey Visit"),
        area: !!screen.queryByText("Lakeside"),
      }),
    );

    renderWithClient(<ProfilePage />);
    await screen.findByText("Lakeside", {}, { timeout: 3000 });
    await settle();
    loaded.stop();

    expect(loaded.frame()).toEqual({ skeletons: 0, email: true, onboarding: true, jobType: true, area: true });
    expect(duplicates(server.requests)).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
});
