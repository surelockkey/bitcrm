import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { duplicates, installFakeServer, renderWithClient, settle, skeletonCount, type FakeServer } from "@/test/page-load";
import { TechniciansPage } from "./technicians-page";

/**
 * The technicians list appears once, whole.
 *
 * It came in waves: "No access" while the user was on the way, then rows
 * reading "Unknown technician" over their ids until the people directory came
 * in and rewrote every one of them with a name, while the "N assignments
 * awaiting review" button turned up beside the filter on its own beat.
 *
 * Now the rows wait for the names, the count and the review queue, and come
 * with them in one frame.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/technicians",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const me = { id: "u-admin", firstName: "Ada", lastName: "Admin", email: "ada@example.com", roleId: "role-admin" };
const people = [me, { id: "u-tech", firstName: "Theo", lastName: "Tech", email: "theo@example.com", roleId: "role-technician" }];
const profile = {
  userId: "u-tech",
  status: "active",
  callMaskingEnabled: false,
  gpsTrackingEnabled: false,
  mobileAppInstalled: false,
  createdAt: "",
  updatedAt: "",
};
const pending = {
  jobTypes: [{ technicianId: "u-tech", jobTypeId: "jt-1", status: "pending" }],
  serviceAreas: [],
};

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface Frame {
  noAccess: boolean;
  skeletons: number;
  rows: number;
  named: boolean;
  unknown: boolean;
  review: boolean;
}

function recordFrames(probe: () => Frame) {
  const frames: Frame[] = [];
  let last = "";
  const observer = new MutationObserver(() => {
    const f = probe();
    const key = JSON.stringify(f);
    if (key !== last) {
      frames.push(f);
      last = key;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  return { frames: () => frames, stop: () => observer.disconnect() };
}

describe("TechniciansPage — loading", () => {
  it("goes from one skeleton to named rows with the review button, in one frame", async () => {
    server = installFakeServer([
      { match: /\/users\/me$/, reply: () => me, delayMs: 30 },
      {
        match: /\/users\/technicians$/,
        raw: true,
        reply: () => ({ success: true, data: [profile], pagination: {} }),
        delayMs: 20,
      },
      { match: /\/users\/technicians\/count$/, reply: () => ({ total: 1 }), delayMs: 20 },
      { match: /\/users\/technicians\/assignments\/pending$/, reply: () => pending, delayMs: 60 },
      // The directory comes last — the order that rewrote the rows.
      { match: /\/users$/, raw: true, reply: () => ({ success: true, data: people, pagination: {} }), delayMs: 90 },
      { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-1", name: "Rekey Visit", priority: 1, active: true }] },
      { match: /\/deals\/service-areas$/, reply: () => [] },
    ]);
    const rec = recordFrames(() => ({
      noAccess: !!screen.queryByText("No access"),
      skeletons: skeletonCount(),
      rows: document.querySelectorAll("tbody tr").length,
      named: !!screen.queryByText("Theo Tech"),
      unknown: !!screen.queryByText("Unknown technician"),
      review: !!screen.queryByRole("button", { name: /awaiting review/i }),
    }));

    renderWithClient(<TechniciansPage />);
    await screen.findByText("Theo Tech");
    await screen.findByRole("button", { name: /awaiting review/i });
    await settle();
    rec.stop();
    const frames = rec.frames();

    expect(frames.some((f) => f.noAccess)).toBe(false);
    expect(frames.some((f) => f.unknown)).toBe(false);
    const first = frames.findIndex((f) => f.rows > 0);
    for (const f of frames.slice(0, first)) expect(f.skeletons).toBeGreaterThan(0);
    expect(frames[first]).toEqual({ noAccess: false, skeletons: 0, rows: 1, named: true, unknown: false, review: true });
    expect(duplicates(server.requests)).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
});
