import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { ApiError } from "@/lib/api/errors";
import * as api from "./api";

const ok = (data: unknown) => HttpResponse.json({ success: true, data });

describe("documents api", () => {
  it("sends the version with a template update and surfaces 409s", async () => {
    let body: unknown;
    server.use(
      http.put("*/billing/templates/t1", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ success: false, error: { code: "CONFLICT", message: "Version mismatch" } }, { status: 409 });
      }),
    );
    const err = await api
      .updateTemplate("t1", {
        name: "x",
        page: {} as never,
        header: [],
        body: [],
        footer: [],
        visibility: {} as never,
        autoApply: { jobTypeIds: [], serviceAreaIds: [], businessProfileIds: [] },
        version: 7,
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(body).toMatchObject({ name: "x", version: 7 });
  });

  it("uploads an asset: ticket, then a PUT with the returned headers", async () => {
    const seen: { ticket?: unknown; putHeaders?: Record<string, string> } = {};
    server.use(
      http.post("*/billing/assets", async ({ request }) => {
        seen.ticket = await request.json();
        return ok({ id: "a1", uploadUrl: "https://s3.example.com/put", headers: { "Content-Type": "image/png", "x-amz-server-side-encryption": "aws:kms" } });
      }),
      http.put("https://s3.example.com/put", ({ request }) => {
        seen.putHeaders = Object.fromEntries(request.headers.entries());
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const file = new File(["png"], "logo.png", { type: "image/png" });
    await expect(api.uploadAsset(file)).resolves.toBe("a1");
    expect(seen.ticket).toEqual({ contentType: "image/png", fileName: "logo.png", size: 3 });
    expect(seen.putHeaders).toMatchObject({ "content-type": "image/png", "x-amz-server-side-encryption": "aws:kms" });
  });

  it("fails with the HTTP status when S3 rejects the upload", async () => {
    server.use(
      http.post("*/billing/assets", () => ok({ id: "a1", uploadUrl: "https://s3.example.com/put", headers: {} })),
      http.put("https://s3.example.com/put", () => new HttpResponse(null, { status: 403 })),
    );
    const err = await api.uploadAsset(new File(["x"], "a.png", { type: "image/png" })).catch((e) => e);
    expect(err).toBeInstanceOf(api.AssetUploadError);
    expect(err.reason).toBe("http");
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/HTTP 403/);
  });

  it("names CORS/network as the reason when the PUT never gets a response", async () => {
    server.use(
      http.post("*/billing/assets", () => ok({ id: "a1", uploadUrl: "https://s3.example.com/put", headers: {} })),
      http.put("https://s3.example.com/put", () => HttpResponse.error()),
    );
    const err = await api.uploadAsset(new File(["x"], "a.png", { type: "image/png" })).catch((e) => e);
    expect(err).toBeInstanceOf(api.AssetUploadError);
    expect(err.reason).toBe("network");
    expect(err.message).toMatch(/Upload blocked — storage CORS\/network/);
  });

  it("reports progress when asked (XHR) and still sends the signed headers", async () => {
    let putHeaders: Record<string, string> = {};
    server.use(
      http.post("*/billing/assets", () =>
        ok({ id: "a2", uploadUrl: "https://s3.example.com/put2", headers: { "Content-Type": "image/png", "x-amz-meta-a": "1" } }),
      ),
      http.put("https://s3.example.com/put2", ({ request }) => {
        putHeaders = Object.fromEntries(request.headers.entries());
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const progress: number[] = [];
    await expect(
      api.uploadAsset(new File(["png"], "logo.png", { type: "image/png" }), (p) => progress.push(p)),
    ).resolves.toBe("a2");
    expect(putHeaders).toMatchObject({ "content-type": "image/png", "x-amz-meta-a": "1" });
    expect(progress.at(-1)).toBe(100);
  });

  it("reports HTTP failures on the progress path too", async () => {
    server.use(
      http.post("*/billing/assets", () => ok({ id: "a3", uploadUrl: "https://s3.example.com/put3", headers: {} })),
      http.put("https://s3.example.com/put3", () => new HttpResponse(null, { status: 400 })),
    );
    const err = await api.uploadAsset(new File(["x"], "a.png", { type: "image/png" }), () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(api.AssetUploadError);
    expect(err.status).toBe(400);
  });

  it("renders html and pdf", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("*/billing/templates/render", async ({ request }) => {
        const b = (await request.json()) as { format: string };
        bodies.push(b);
        return ok(b.format === "pdf" ? { url: "https://pdf" } : { html: "<p>x</p>" });
      }),
    );
    const content = { page: {}, header: [], body: [], footer: [], visibility: {} } as never;
    await expect(api.renderTemplateHtml({ kind: "invoice", content, source: { kind: "invoice", id: "d1" } })).resolves.toBe("<p>x</p>");
    await expect(api.renderTemplatePdf({ kind: "invoice", content })).resolves.toBe("https://pdf");
    expect(bodies[0]).toMatchObject({ format: "html", source: { kind: "invoice", id: "d1" } });
    expect(bodies[1]).toMatchObject({ format: "pdf" });
  });

  it("searches invoices by number for the preview picker", async () => {
    server.use(
      http.get("*/billing/invoices", () =>
        ok({ items: [{ id: "d1", number: "1042", totals: { total: 10 }, createdAt: "2026-01-01" }, { id: "d2", number: "2001", totals: { total: 5 }, createdAt: "2026-01-02" }] }),
      ),
    );
    const res = await api.searchPreviewSources("invoice", "104");
    expect(res.map((r) => r.id)).toEqual(["d1"]);
    expect(res[0]).toMatchObject({ kind: "invoice", label: "Invoice #1042" });
  });

  it("includes an exact id match when nothing matches by number", async () => {
    server.use(
      http.get("*/billing/estimates", () => ok({ items: [] })),
      http.get("*/billing/estimates/e-xyz", () => ok({ id: "e-xyz", number: "7-1", name: "Good", totals: { total: 1 }, createdAt: "x" })),
    );
    const res = await api.searchPreviewSources("estimate", "e-xyz");
    expect(res).toEqual([expect.objectContaining({ id: "e-xyz", label: "Estimate #7-1 · Good" })]);
  });
});
