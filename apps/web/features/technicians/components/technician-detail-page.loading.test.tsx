import { afterEach, describe, expect, it, vi } from "vitest";
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
import { TechnicianDetailPage } from "./technician-detail-page";

/**
 * The technician card appears once, whole.
 *
 * It came up in pieces, and each one moved what was under it (CLS 0.05 on the
 * dev site): the email line under the name arrived with the people directory
 * and pushed the tabs and the form down; the job types and service areas each
 * held a grey bar until the technician's assignments came, then their chips
 * arrived as ids and were renamed when the catalogs did — and every block
 * below them (Schedule color, Hide client numbers, …) slid each time.
 *
 * Now the card waits for all of it behind one skeleton and comes in one frame.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/technicians/u-tech",
}));
// A Google Places widget, not page data.
vi.mock("@/features/deals/components/address-autocomplete", () => ({
  AddressAutocomplete: ({ value, id }: { value: string; id?: string }) => <input id={id} defaultValue={value} />,
}));

const me = { id: "u-admin", firstName: "Ada", lastName: "Admin", email: "ada@example.com", roleId: "role-admin" };
const tech = { id: "u-tech", firstName: "Theo", lastName: "Tech", email: "theo@example.com", roleId: "role-technician" };

const profile = {
  userId: "u-tech",
  technicianType: "regular",
  callMaskingEnabled: false,
  gpsTrackingEnabled: false,
  mobileAppInstalled: false,
  status: "active",
  createdAt: "",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const assignments = {
  jobTypes: [{ technicianId: "u-tech", jobTypeId: "jt-rekey", status: "approved" }],
  serviceAreas: [{ technicianId: "u-tech", serviceAreaId: "sa-lake", status: "approved" }],
};

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TechnicianDetailPage — loading", () => {
  it("brings the name, the email and the named assignments in the card's first frame", async () => {
    server = installFakeServer([
      { match: /\/users\/me$/, reply: () => me, delayMs: 10 },
      { match: /\/users\/technicians\/u-tech\/profile$/, reply: () => profile, delayMs: 20 },
      { match: /\/users\/technicians\/u-tech\/assignments$/, reply: () => assignments, delayMs: 40 },
      // The catalogs and the directory last — the order that moved the card.
      { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-rekey", name: "Rekey Visit", priority: 1, active: true }], delayMs: 80 },
      {
        match: /\/deals\/service-areas$/,
        reply: () => [{ id: "sa-lake", name: "Lakeside", priority: 1, active: true }],
        delayMs: 80,
      },
      { match: /\/users$/, raw: true, reply: () => ({ success: true, data: [me, tech], pagination: {} }), delayMs: 90 },
    ]);
    const first = watchFirstFrame(
      () => !!screen.queryByRole("tab", { name: "Profile" }),
      () => ({
        noAccess: !!screen.queryByText("No access"),
        skeletons: skeletonCount(),
        name: !!screen.queryByRole("heading", { name: "Theo Tech" }),
        email: !!screen.queryByText("theo@example.com"),
        jobType: !!screen.queryByText("Rekey Visit"),
        area: !!screen.queryByText("Lakeside"),
      }),
    );
    const refused = watchFirstFrame(
      () => !!screen.queryByText("No access"),
      () => true,
    );

    renderWithClient(<TechnicianDetailPage technicianId="u-tech" />);
    await screen.findByText("Lakeside");
    await screen.findByText("theo@example.com");
    await settle();
    first.stop();
    refused.stop();

    expect(refused.frame()).toBeNull();
    expect(first.frame()).toEqual({ noAccess: false, skeletons: 0, name: true, email: true, jobType: true, area: true });
    expect(duplicates(server.requests)).toEqual([]);
  });
});
