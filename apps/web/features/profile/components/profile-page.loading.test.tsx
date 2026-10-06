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
import { ProfilePage } from "./profile-page";

/**
 * My Profile appears in place.
 *
 * While the signed-in user was on the way the page was a bare, centred column
 * of grey bars; when the user came, that same box became the page — full
 * width, with a heading on top — so everything on screen jumped sideways and
 * down at once (CLS 0.09 on the dev site, the worst of the settings pages).
 * And a technician's own section came in pieces after that: a plain
 * "Technician" strip that turned into the onboarding banner, over a form that
 * was still a grey bar.
 *
 * Now the heading stands where it will stay from the first frame, the cards
 * wait under it in the column they will fill, and a technician's section
 * comes whole with the rest.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/profile",
}));
// A Google Places widget, not page data.
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value }: { value: string }) => <input aria-label="Home address" defaultValue={value} />,
}));

const admin = {
  id: "u-admin",
  firstName: "Ada",
  lastName: "Admin",
  email: "ada@example.com",
  roleId: "role-admin",
  status: "active",
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "",
};

const tech = { ...admin, id: "u-tech", firstName: "Theo", lastName: "Tech", email: "theo@example.com", roleId: "role-technician" };

const techProfile = {
  userId: "u-tech",
  callMaskingEnabled: false,
  gpsTrackingEnabled: false,
  mobileAppInstalled: false,
  status: "pending",
  createdAt: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const onboarding = {
  status: "pending",
  checklist: { profileComplete: true, assignmentsApproved: false, commissionSet: false },
  completedSteps: 1,
  totalSteps: 3,
};

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const heading = () => screen.queryByRole("heading", { name: "My Profile" });

describe("ProfilePage — loading", () => {
  it("holds the heading in place from the first frame, and the cards come whole under it", async () => {
    server = installFakeServer([{ match: /\/users\/me$/, reply: () => admin, delayMs: 60 }]);
    // The first frame anything of the page is on screen.
    const loading = watchFirstFrame(
      () => skeletonCount() > 0 || !!heading(),
      () => ({ heading: heading(), skeletons: skeletonCount(), name: !!screen.queryByText("Ada Admin") }),
    );
    const loaded = watchFirstFrame(
      () => !!screen.queryByText("Ada Admin"),
      () => ({
        heading: heading(),
        skeletons: skeletonCount(),
        security: !!screen.queryByText("Security"),
        twoStep: !!screen.queryByText("Two-step sign-in"),
      }),
    );

    renderWithClient(<ProfilePage />);
    await screen.findByText("Ada Admin");
    await settle();
    loading.stop();
    loaded.stop();

    // The page is still loading in its first frame — and its heading is
    // already up, in the very element it will keep.
    expect(loading.frame()?.name).toBe(false);
    expect(loading.frame()?.skeletons).toBeGreaterThan(0);
    expect(loading.frame()?.heading).not.toBeNull();
    expect(loading.frame()?.heading).toBe(heading());
    // The cards come in one frame, with no grey left.
    expect(loaded.frame()).toEqual(expect.objectContaining({ skeletons: 0, security: true, twoStep: true }));
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("brings a technician's own section in with the rest", async () => {
    server = installFakeServer([
      { match: /\/users\/me$/, reply: () => tech, delayMs: 20 },
      { match: /\/users\/technicians\/u-tech\/onboarding-status$/, reply: () => onboarding, delayMs: 80 },
      { match: /\/users\/technicians\/u-tech\/profile$/, reply: () => techProfile, delayMs: 50 },
    ]);
    const loaded = watchFirstFrame(
      () => !!screen.queryByText("Theo Tech"),
      () => ({
        skeletons: skeletonCount(),
        banner: !!screen.queryByText(/Onboarding · 1 of 3/),
        form: !!screen.queryByRole("button", { name: /save profile/i }),
      }),
    );

    renderWithClient(<ProfilePage />);
    await screen.findByText("Theo Tech");
    await screen.findByRole("button", { name: /save profile/i });
    await settle();
    loaded.stop();

    expect(loaded.frame()).toEqual({ skeletons: 0, banner: true, form: true });
    expect(duplicates(server.requests)).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
});
