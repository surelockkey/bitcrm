import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/calls/flows/f1",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isTechnician: false, isLoading: false, me: { id: "me" } }),
}));
vi.mock("@/features/business-profiles/components/business-profile-select", () => ({
  BusinessProfileSelect: () => null,
}));

const flow = {
  id: "f1",
  name: "Main line",
  numbers: ["+15412830739"],
  entryNodeId: "ring",
  nodes: { ring: { id: "ring", type: "ring", groupId: "g1" } },
  active: true,
  version: 1,
  createdBy: "u",
  createdAt: "",
  updatedAt: "",
};
// A flow that forwards to a teammate, then a device, then an outside number.
const forwards = {
  ...flow,
  id: "f2",
  name: "After hours",
  entryNodeId: "u",
  nodes: {
    u: { id: "u", type: "ring", target: { kind: "user", id: "u-riley" }, next: "d" },
    d: { id: "d", type: "ring", target: { kind: "device", id: "d-ct" }, next: "x" },
    x: { id: "x", type: "ring", target: { kind: "external", number: "+18888996849" } },
  },
};
const routes: FakeRoute[] = [
  { match: /\/telephony\/call-flows$/, reply: () => [flow, forwards] },
  // The group the ring card names answers last.
  { match: /\/telephony\/call-groups$/, reply: () => [{ id: "g1", name: "Front desk", type: "ring_all", members: [], active: true }], delayMs: 80 },
  { match: /\/telephony\/numbers$/, reply: () => [{ sid: "PN1", phoneNumber: "+15412830739", friendlyName: "Main" }], delayMs: 40 },
  // The Forward step's User and Device tabs, named on the cards too.
  { match: /\/telephony\/presence\/online$/, reply: () => [{ id: "u-riley", name: "Riley CSR", softphoneOnline: true }], delayMs: 60 },
  { match: /\/telephony\/devices$/, reply: () => [{ id: "d-ct", name: "SURE CT LOCKSMITH", number: "+12039893585", type: "shop_line", active: true }], delayMs: 60 },
];

let server: FakeServer;
const { CallFlowBuilderPage } = await import("./call-flow-builder-page");

beforeEach(() => {
  nav.push.mockReset();
  server = installFakeServer(routes);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The builder as a page of its own (`/calls/flows/<id>`, Workiz's
 * /root/flowBuilder/<id>): one skeleton, then the whole builder — the ring
 * card already naming its group — with its ← back to the list.
 */
describe("CallFlowBuilderPage", () => {
  it("comes in whole: the ring card names its group in the first frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByRole("heading", { name: "Main line" }),
      () => ({ card: !!screen.queryByRole("button", { name: /Front desk/ }), skeletons: skeletonCount() }),
    );
    renderWithClient(<CallFlowBuilderPage flowId="f1" />);
    await screen.findByRole("heading", { name: "Main line" }, { timeout: 3000 });
    watch.stop();
    expect(watch.frame()).toEqual({ card: true, skeletons: 0 });
  });

  it("names a teammate, a device and an outside number on their Forward cards in the first frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByRole("heading", { name: "After hours" }),
      () => ({
        user: !!screen.queryByRole("button", { name: "Edit Forward — Riley CSR" }),
        device: !!screen.queryByRole("button", { name: "Edit Forward — SURE CT LOCKSMITH" }),
        external: !!screen.queryByRole("button", { name: "Edit Forward — (888) 899-6849" }),
        skeletons: skeletonCount(),
      }),
    );
    renderWithClient(<CallFlowBuilderPage flowId="f2" />);
    await screen.findByRole("heading", { name: "After hours" }, { timeout: 3000 });
    watch.stop();
    expect(watch.frame()).toEqual({ user: true, device: true, external: true, skeletons: 0 });
  });

  it("opens on an API that has no Devices yet", async () => {
    server = installFakeServer([
      ...routes.filter((r) => !r.match.test("/api/telephony/devices")),
      { match: /\/telephony\/devices$/, reply: () => ({ success: false, message: "Cannot GET" }), raw: true, status: 404 },
    ]);
    renderWithClient(<CallFlowBuilderPage flowId="f2" />);
    expect(await screen.findByRole("button", { name: "Edit Forward — a deleted device" }, { timeout: 3000 })).toBeInTheDocument();
  });

  it("asks for each thing once", async () => {
    renderWithClient(<CallFlowBuilderPage flowId="f1" />);
    await screen.findByRole("heading", { name: "Main line" }, { timeout: 3000 });
    await settle();
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("goes back to the list from its ←", async () => {
    const u = userEvent.setup();
    renderWithClient(<CallFlowBuilderPage flowId="f1" />);
    await u.click(await screen.findByRole("button", { name: "Back to call flows" }, { timeout: 3000 }));
    expect(nav.push).toHaveBeenCalledWith("/calls/flows");
  });

  it("opens a new flow on Basic info", async () => {
    renderWithClient(<CallFlowBuilderPage />);
    expect(await screen.findByRole("dialog", { name: "Basic info" }, { timeout: 3000 })).toBeInTheDocument();
  });

  it("says so when the flow is gone", async () => {
    renderWithClient(<CallFlowBuilderPage flowId="nope" />);
    expect(await screen.findByText("This call flow no longer exists.", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to call flows" })).toHaveAttribute("href", "/calls/flows");
  });
});
