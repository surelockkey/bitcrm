import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortalView } from "@bitcrm/types";
import { PortalApp } from "./portal-app";

const view: PortalView = {
  business: { name: "Acme Locks", phone: "+14045550100" },
  client: { firstName: "Jane", lastName: "Smith" },
  estimates: [],
  invoices: [
    { kind: "invoice", id: "d1", number: "1042", date: "2026-09-12", status: "due", total: 300, balanceDue: 300, sent: true },
  ],
  proposals: [],
  jobs: [],
  payments: [],
  preview: false,
};

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const fail = (status: number, body: unknown = { success: false, message: "no" }) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("PortalApp", () => {
  it("loads the portal for the token and shows the client's documents", async () => {
    const f = vi.fn(async () => ok(view));
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);
    expect(screen.getByRole("status", { name: /loading your documents/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Hey Jane, it's great to see you.");
    expect(screen.getByRole("button", { name: "Invoice #1042" })).toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("opens an invoice as a page: the HTML render is fetched, the PDF is not", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/html") ? ok({ html: "<html><head></head><body>invoice</body></html>" }) : ok(view),
    );
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Invoice #1042" }));
    expect(await screen.findByTitle("Invoice #1042")).toBeInTheDocument();
    const urls = f.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toContain("https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/invoice/d1/html");
    expect(urls.some((u) => u.includes("/pdf"))).toBe(false);
  });

  it("shows the dead-link page (with the business name) for a revoked link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(404, { success: false, message: "gone", businessName: "Acme Locks" })));
    render(<PortalApp token="tok" />);
    expect(await screen.findByText("This link is no longer valid")).toBeInTheDocument();
    expect(screen.getByText(/contact Acme Locks/i)).toBeInTheDocument();
  });

  it("offers a retry on a transient failure, and recovers", async () => {
    const f = vi.fn().mockResolvedValueOnce(fail(503)).mockResolvedValue(ok(view));
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Hey Jane");
  });
});

const options = {
  invoiceId: "d1",
  number: "1042",
  amountDue: 300,
  amountPending: 0,
  currency: "usd",
  methods: ["card"],
  allowPartial: true,
  bankMinimum: 20,
  surchargePercent: 0,
  surchargeLabel: "Card processing fee",
  tipsEnabled: false,
  tipPresets: [],
};

const payableView: PortalView = { ...view, invoices: [{ ...view.invoices[0], payable: true }] };

function route(map: Array<[string, unknown]>) {
  return vi.fn(async (url: string) => {
    const hit = map.find(([fragment]) => url.includes(fragment));
    return ok(hit ? hit[1] : view);
  });
}

afterEach(() => window.history.replaceState({}, "", "/"));

describe("PortalApp — paying", () => {
  it("opens the payment panel from the invoice and asks what this invoice accepts", async () => {
    const f = route([["/payment-options", options], ["portal/tok", payableView]]);
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);

    await userEvent.click(await screen.findByRole("button", { name: "Invoice #1042" }));
    await userEvent.click(await screen.findByRole("button", { name: /^pay invoice$/i }));
    expect(await screen.findByLabelText(/amount to pay/i)).toHaveValue("300.00");
    const urls = f.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toContain("https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/invoice/d1/payment-options");
  });

  it("picks the payment back up after a redirect, then re-reads the balances", async () => {
    window.history.replaceState({}, "", "/tok?payment=pay_1&invoice=d1");
    const f = route([
      ["/payment/pay_1", { status: "settled", amount: 300, method: "card", receiptSent: true }],
      ["portal/tok", payableView],
    ]);
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);

    expect(await screen.findByText(/payment received/i)).toBeInTheDocument();
    const portalReads = f.mock.calls.filter((c) => (c as unknown as [string])[0].endsWith("/portal/tok"));
    expect(portalReads.length).toBe(2);
  });

  it("cleans the payment id out of the address bar so a refresh doesn't replay it", async () => {
    window.history.replaceState({}, "", "/tok?payment=pay_1&invoice=d1");
    vi.stubGlobal("fetch", route([["/payment/pay_1", { status: "settled", amount: 300, method: "card", receiptSent: true }], ["portal/tok", payableView]]));
    render(<PortalApp token="tok" />);
    await screen.findByText(/payment received/i);
    expect(window.location.search).toBe("");
  });
});


describe("PortalApp — approving an estimate", () => {
  const estimateView: PortalView = {
    ...view,
    invoices: [],
    estimates: [
      { kind: "estimate", id: "e1", number: "1042-1", name: "Storefront door", date: "2026-09-30", status: "pending", total: 500, sent: true, signatureNeeded: true, depositDue: 250, payable: true },
    ],
  };
  const depositOptions = {
    estimateId: "e1", number: "1042-1", depositDue: 250, amountPaid: 0, amountDue: 250, amountPending: 0, signed: true,
    currency: "usd", methods: ["card"], allowPartial: false, bankMinimum: 20, surchargePercent: 0, surchargeLabel: "Card processing fee",
  };

  it("Approve & pay deposit: signs first (POST …/approve), then asks for the deposit", async () => {
    const ctx = { scale: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() };
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
    HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,QUJD") as never;
    HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 160 }) as DOMRect;
    const bodies: Array<[string, unknown]> = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.body) bodies.push([url, JSON.parse(String(init.body))]);
      if (url.includes("/approve")) return ok({ ...estimateView.estimates[0], status: "approved" });
      if (url.includes("/deposit-options")) return ok(depositOptions);
      if (url.endsWith("/html")) return ok({ html: "<html><head></head><body>estimate</body></html>" });
      return ok(estimateView);
    });
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Estimate #1042-1 Storefront door" }));
    await userEvent.click(await screen.findByRole("button", { name: /approve & pay deposit/i }));
    const canvas = await screen.findByRole("img", { name: /sign here/i });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByLabelText(/amount to pay/i)).toHaveValue("250.00");
    const approve = bodies.find(([u]) => u.includes("/estimate/e1/approve"));
    expect(approve?.[1]).toEqual({ imageDataUrl: "data:image/png;base64,QUJD", signedBy: "Jane Smith" });
    const urls = f.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls.indexOf(urls.find((u) => u.includes("/approve"))!)).toBeLessThan(urls.indexOf(urls.find((u) => u.includes("/deposit-options"))!));
  });

  it("Decline asks for a reason and posts it", async () => {
    const bodies: Array<[string, unknown]> = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.body) bodies.push([url, JSON.parse(String(init.body))]);
      if (url.includes("/decline")) return ok({ ...estimateView.estimates[0], status: "declined" });
      if (url.endsWith("/html")) return ok({ html: "<html><head></head><body>estimate</body></html>" });
      return ok(estimateView);
    });
    vi.stubGlobal("fetch", f);
    render(<PortalApp token="tok" />);
    await userEvent.click(await screen.findByRole("button", { name: "Estimate #1042-1 Storefront door" }));
    await userEvent.click(await screen.findByRole("button", { name: /^decline$/i }));
    const dialog = await screen.findByRole("dialog", { name: /decline estimate/i });
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Too expensive");
    await userEvent.click(within(dialog).getByRole("button", { name: /^decline$/i }));
    await screen.findByRole("heading", { level: 1 });
    expect(bodies.find(([u]) => u.includes("/decline"))?.[1]).toEqual({ reason: "Too expensive" });
  });
});
