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
const routes: FakeRoute[] = [
  { match: /\/telephony\/call-flows$/, reply: () => [flow] },
  // The group the ring card names answers last.
  { match: /\/telephony\/call-groups$/, reply: () => [{ id: "g1", name: "Front desk", type: "ring_all", members: [], active: true }], delayMs: 80 },
  { match: /\/telephony\/numbers$/, reply: () => [{ sid: "PN1", phoneNumber: "+15412830739", friendlyName: "Main" }], delayMs: 40 },
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
