import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicApiError } from "@bitcrm/portal-ui";
import { getDocumentHtml, getDocumentPdfUrl, getPortal, publicGet } from "./api";

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
