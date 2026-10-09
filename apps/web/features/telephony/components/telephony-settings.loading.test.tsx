import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ReactElement } from "react";
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
 * Settings → Call flows, Call groups and Phone numbers do not jump.
 *
 * Each said "No access" until the permissions came. Call flows then printed
 * "ring a deleted group" under every flow until the groups arrived and
 * renamed it. Phone numbers drew its rows, asked for each number's source
 * and company only then, and its pickers asked for the catalogs that name
 * them only once they had mounted — "No source" turned into "Yard signs" a
 * beat after the table was up.
 *
 * Now each appears once, whole.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings",
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

const group = { id: "g1", name: "Front desk", type: "ring_all", members: [], active: true, ringSeconds: 25, createdBy: "u", createdAt: "", updatedAt: "" };
const flow = {
  id: "f1",
  name: "Main line",
  numbers: ["+15412830739"],
  entryNodeId: "ring",
  nodes: {
    ring: { id: "ring", type: "ring", groupId: "g1", next: "tech" },
    // A Forward to one teammate, then to a shop line (Devices).
    tech: { id: "tech", type: "ring", target: { kind: "user", id: "u-riley" }, next: "shop" },
    shop: { id: "shop", type: "ring", target: { kind: "device", id: "d-ct" } },
  },
  active: true,
  version: 1,
  createdBy: "u",
  createdAt: "",
  updatedAt: "",
};

const routes: FakeRoute[] = [
  { match: /\/telephony\/call-flows$/, reply: () => [flow] },
  // What names things on these pages answers after the rows.
  { match: /\/telephony\/call-groups$/, reply: () => [group], delayMs: 70 },
  { match: /\/telephony\/presence\/online$/, reply: () => [{ id: "u-riley", name: "Riley CSR", softphoneOnline: true }], delayMs: 60 },
  { match: /\/telephony\/devices$/, reply: () => [{ id: "d-ct", name: "SURE CT LOCKSMITH", number: "+12039893585", type: "shop_line", active: true }], delayMs: 80 },
  // The Fallback Number row at the top of the flows grid.
  { match: /\/telephony\/config$/, reply: () => ({ technicianLine: null, fallbackNumber: "+18557951267" }), delayMs: 90 },
  { match: /\/telephony\/numbers$/, reply: () => [{ sid: "PN1", phoneNumber: "+14045551234", friendlyName: "Ads line" }] },
  {
    match: /\/telephony\/numbers\/settings$/,
    reply: () => [{ phoneNumber: "+14045551234", sourceId: "src-1", businessProfileId: "bp-1" }],
    delayMs: 50,
  },
  { match: /\/deals\/job-sources$/, reply: () => [{ id: "src-1", name: "Yard signs", active: true, priority: 0 }], delayMs: 70 },
  {
    match: /\/billing\/business-profiles$/,
    reply: () => [{ id: "bp-1", name: "North Co", active: true, isDefault: true }],
    delayMs: 70,
  },
];

let server: FakeServer;

const { CallFlowsPage } = await import("./call-flows-page");
const { CallGroupsPage } = await import("./call-groups-page");
const { PhoneNumbersPage } = await import("./phone-numbers-page");

const renderPage = (page: ReactElement) => renderWithClient(<TooltipProvider>{page}</TooltipProvider>);

beforeEach(() => {
  perms.isLoading = false;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("telephony settings — no jumping", () => {
  it.each([
    ["Call flows", <CallFlowsPage key="f" />],
    ["Call groups", <CallGroupsPage key="g" />],
    ["Phone numbers", <PhoneNumbersPage key="n" />],
  ])("%s waits for the permissions instead of saying No access", async (_name, page) => {
    perms.isLoading = true;
    renderPage(page);
    await settle(30);

    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(skeletonCount()).toBeGreaterThan(0);
  });

  it("Call flows names the group a flow rings in its first frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Main line"),
      () => ({ path: screen.queryByText(/^ring /)?.textContent ?? null, skeletons: skeletonCount() }),
    );
    renderPage(<CallFlowsPage />);
    await screen.findByText("Main line", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ path: "ring Front desk → ring Riley CSR → ring SURE CT LOCKSMITH", skeletons: 0 });
  });

  it("Call flows draws its Fallback Number row, number and all, in its first frame", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("Main line"),
      () => ({
        row: !!screen.queryByText("Fallback Number"),
        number: !!screen.queryByText("(855) 795-1267"),
        skeletons: skeletonCount(),
      }),
    );
    renderPage(<CallFlowsPage />);
    await screen.findByText("Main line", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ row: true, number: true, skeletons: 0 });
  });

  it("Phone numbers draws each number with its source and company named", async () => {
    const watch = watchFirstFrame(
      () => !!screen.queryByText("(404) 555-1234"),
      () => ({
        source: !!screen.queryByText("Yard signs"),
        company: !!screen.queryByText("North Co"),
        skeletons: skeletonCount(),
      }),
    );
    renderPage(<PhoneNumbersPage />);
    await screen.findByText("(404) 555-1234", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ source: true, company: true, skeletons: 0 });
  });

  it.each([
    ["Call flows", <CallFlowsPage key="f" />, "Main line"],
    ["Call groups", <CallGroupsPage key="g" />, "Front desk"],
    ["Phone numbers", <PhoneNumbersPage key="n" />, "(404) 555-1234"],
  ])("%s asks for each thing once", async (_name, page, text) => {
    renderPage(page);
    await screen.findByText(text, {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
