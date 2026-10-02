import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicApiError } from "@bitcrm/portal-ui";
import { getDocumentHtml, getDocumentPdfUrl, getPaymentOptions, getPaymentStatus, getPortal, getPortalInbox, publicGet, startPayment } from "./api";

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const doc = { kind: "invoice", id: "d 1", number: "1", date: "2026-09-01", status: "due", total: 1, sent: true } as const;

afterEach(() => vi.unstubAllGlobals());

describe("publicGet", () => {
  it("sends no credentials and unwraps the envelope", async () => {
    const f = stubFetch(200, { success: true, data: { hello: "world" } });
    await expect(publicGet("/x")).resolves.toEqual({ hello: "world" });
    expect(f).toHaveBeenCalledWith(
      "https://api.bitcrm.tech-slk.com/api/x",
      expect.objectContaining({ method: "GET", credentials: "omit", headers: { Accept: "application/json" } }),
    );
  });

  it("turns an error envelope into a PublicApiError carrying status and business name", async () => {
    stubFetch(404, { success: false, message: "This link is no longer valid", businessName: "Acme" });
    await expect(publicGet("/x")).rejects.toMatchObject({ name: "PublicApiError", status: 404, businessName: "Acme" });
  });

  it("reports an unreachable server as status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const err = await publicGet("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PublicApiError);
    expect(err).toMatchObject({ status: 0 });
  });
});

describe("portal endpoints", () => {
  it("encodes the token and document id into the token-gated paths", async () => {
    const f = stubFetch(200, { success: true, data: {} });
    await getPortal("tok/en");
    await getDocumentHtml("tok", doc);
    await getDocumentPdfUrl("tok", doc, false);
    await getDocumentPdfUrl("tok", doc, true);
    const urls = f.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual([
      "https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok%2Fen",
      "https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/invoice/d%201/html",
      "https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/invoice/d%201/pdf",
      "https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/invoice/d%201/pdf?download=1",
    ]);
  });
});

describe("inbox pages", () => {
  it("asks for one page by cursor and filter; the whole inbox needs no show, the default size no limit", async () => {
    const f = stubFetch(200, { success: true, data: {} });
    await getPortalInbox("tok", { cursor: "c/1", limit: 10, show: ["invoices", "unpaid"] });
    await getPortalInbox("tok", { limit: 25, show: ["invoices", "estimates", "paid", "unpaid"] });
    const urls = f.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual([
      "https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/inbox?cursor=c%2F1&show=invoices%2Cunpaid",
      "https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/inbox?limit=25",
    ]);
  });
});

describe("payment endpoints", () => {
  it("reads the options for one invoice off the token-gated path", async () => {
    const f = stubFetch(200, { success: true, data: { amountDue: 10 } });
    await expect(getPaymentOptions("tok", "d 1")).resolves.toEqual({ amountDue: 10 });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/invoice/d%201/payment-options",
    );
  });

  it("posts the amount and method as JSON, with no credentials, and gets a client secret back", async () => {
    const f = stubFetch(200, { success: true, data: { clientSecret: "cs_1", publishableKey: "pk_1" } });
    await expect(startPayment("tok", "d1", { amount: 120.5, method: "card" })).resolves.toMatchObject({ clientSecret: "cs_1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/invoice/d1/pay");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(init.body).toBe(JSON.stringify({ amount: 120.5, method: "card" }));
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("surfaces a refused payment as a PublicApiError the panel can read", async () => {
    stubFetch(429, { success: false, message: "Too many attempts. Please wait a minute." });
    await expect(startPayment("tok", "d1", { amount: 1, method: "card" })).rejects.toMatchObject({
      status: 429,
      message: "Too many attempts. Please wait a minute.",
    });
  });

  it("polls one payment by id", async () => {
    const f = stubFetch(200, { success: true, data: { status: "settled" } });
    await expect(getPaymentStatus("tok", "pay 1")).resolves.toEqual({ status: "settled" });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.bitcrm.tech-slk.com/api/billing/public/portal/tok/payment/pay%201",
    );
  });
});
