import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClientType, DealPriority, DealStatus, JobSuperStatus } from "@bitcrm/types";
import type { Contact, Deal, EstimateWithItems } from "@bitcrm/types";
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
 * An estimate's page appears once, whole.
 *
 * It came up in four waves: a grey block until the estimate answered; then
 * "← Job ID" over another grey block until the job did; then the editor with
 * one tab (the job's other estimates still on their way), "—" for the client,
 * and "Loading…" in the Template and Tax pickers; then all of that filling in.
 *
 * Now what needs only the estimate's id goes out with the estimate, what
 * needs its job and client goes out the moment it lands, and the page shows
 * once everything is in — and asks for nothing more.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/estimates/e1",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const totals = {
  lineCount: 0, subtotal: 0, taxableSubtotal: 0, nonTaxableSubtotal: 0, discount: 0,
  taxableBase: 0, taxRatePercent: 0, tax: 0, total: 0, amountPaid: 0, balanceDue: 0,
};
const estimate = (over: Partial<EstimateWithItems>): EstimateWithItems => ({
  id: "e1", number: "1042-1", dealId: "d1", dealNumber: "1042", contactId: "c1", name: "Good", status: "unsent",
  estimateDate: "2026-09-16", totals, version: 1, createdBy: "u1", createdAt: "2026-09-16T10:00:00.000Z",
  updatedAt: "2026-09-16T10:00:00.000Z", items: [], ...over,
});
const e1 = estimate({});
const e2 = estimate({ id: "e2", number: "1042-2", name: "Better", createdAt: "2026-09-16T12:00:00.000Z" });
const clientEstimate = estimate({ id: "e9", number: "1141", dealId: undefined, dealNumber: undefined, name: "Front door" });

const deal: Deal = {
  id: "d1", dealNumber: "1042", contactId: "c1", clientType: ClientType.RESIDENTIAL, serviceArea: "North",
  address: { street: "1 Main St", city: "Hartford", state: "CT", zip: "06103" }, jobTypeId: "jt-1",
  superStatus: JobSuperStatus.SUBMITTED, assignedDispatcherId: "u1", priority: DealPriority.NORMAL, assignedTechIds: [], tagIds: [],
  status: DealStatus.ACTIVE, createdBy: "u1", createdAt: "", updatedAt: "",
};

const contact = {
  id: "c1", firstName: "Jane", lastName: "Client", phones: ["+18605550199"], emails: ["jane@client.test"],
  addresses: [{ street: "100 Park Blvd", city: "San Diego", state: "CA", zip: "92101" }],
} as unknown as Contact;

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  { match: /\/billing\/estimates\/e1$/, reply: () => e1, delayMs: 40 },
  { match: /\/billing\/estimates\/e9$/, reply: () => clientEstimate, delayMs: 40 },
  { match: /\/deals\/d1$/, reply: () => deal },
  { match: /\/deals\/d1\/products$/, reply: () => [] },
  // The job's other estimates — the tabs — come last.
  { match: /\/billing\/estimates\/by-deal\/d1$/, reply: () => [e2, e1], delayMs: 80 },
  { match: /\/crm\/contacts\/c1$/, reply: () => contact, delayMs: 50 },
  { match: /\/billing\/templates$/, reply: () => [{ id: "t1", kind: "estimate", name: "Classic", isDefault: true }] },
  { match: /\/deals\/tax-rates$/, reply: () => [] },
  { match: /\/billing\/document-settings$/, reply: () => ({}) },
];

let server: FakeServer;

const { StandaloneEstimatePage } = await import("./estimate-page");

const pickersLoading = () => screen.queryAllByText("Loading…").length;

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StandaloneEstimatePage — no jumping", () => {
  it("shows a job's estimate whole: every tab, the client, the pickers", async () => {
    const pageUp = () => !!screen.queryByText(/Job ID/) || !!screen.queryByText("Client details");
    const watch = watchFirstFrame(pageUp, () => {
      const tabs = screen.queryByRole("tablist", { name: "Estimates" });
      return {
        jobLink: !!screen.queryByText(/Job ID:\s*1042/),
        tabs: tabs ? within(tabs).queryAllByRole("tab").map((t) => t.textContent?.trim()) : null,
        client: !!screen.queryByText("Jane Client"),
        pickersLoading: pickersLoading(),
        skeletons: skeletonCount(),
        asked: server.requests.length,
      };
    });
    renderWithClient(<TooltipProvider><StandaloneEstimatePage estimateId="e1" /></TooltipProvider>);
    await screen.findByText("Client details", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, tabs, ...frame } = watch.frame()!;
    expect(frame).toEqual({ jobLink: true, client: true, pickersLoading: 0, skeletons: 0 });
    expect(tabs?.filter((t) => /Good|Better/.test(t ?? ""))).toHaveLength(2);
    // Nothing more is fetched for what is already on screen.
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });

  it("shows a client's estimate whole: Bill to and the pickers in the first frame", async () => {
    const pageUp = () => !!screen.queryByText("Bill to:");
    const watch = watchFirstFrame(pageUp, () => ({
      client: !!screen.queryByRole("link", { name: "Jane Client" }),
      billTo: !!screen.queryByText(/100 Park Blvd/),
      pickersLoading: pickersLoading(),
      skeletons: skeletonCount(),
      asked: server.requests.length,
    }));
    renderWithClient(<TooltipProvider><StandaloneEstimatePage estimateId="e9" /></TooltipProvider>);
    await screen.findByText("Bill to:", {}, { timeout: 3000 });
    await settle();
    watch.stop();

    const { asked, ...frame } = watch.frame()!;
    expect(frame).toEqual({ client: true, billTo: true, pickersLoading: 0, skeletons: 0 });
    expect(server.requests.slice(asked)).toEqual([]);
    expect(duplicates(server.requests)).toEqual([]);
  });
});
