import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { ApiError } from "@/lib/api/errors";
import * as api from "./api";

const ok = (data: unknown) => HttpResponse.json({ success: true, data });

describe("business profiles api", () => {
  it("lists companies, including archived ones", async () => {
    let url = "";
    server.use(
      http.get("*/billing/business-profiles", ({ request }) => {
        url = request.url;
        return ok([{ id: "bp-default", name: "A" }]);
      }),
    );
    await expect(api.listBusinessProfiles()).resolves.toEqual([{ id: "bp-default", name: "A" }]);
    expect(new URL(url).searchParams.get("includeInactive")).toBe("true");
  });

  it("creates, updates (with nulls), sets default and deletes", async () => {
    const seen: { method: string; path: string; body?: unknown }[] = [];
    server.use(
      http.post("*/billing/business-profiles", async ({ request }) => {
        seen.push({ method: "POST", path: "", body: await request.json() });
        return ok({ id: "bp-2" });
      }),
      http.put("*/billing/business-profiles/:id", async ({ request, params }) => {
        seen.push({ method: "PUT", path: String(params.id), body: await request.json() });
        return ok({ id: params.id });
      }),
      http.post("*/billing/business-profiles/:id/default", ({ params }) => {
        seen.push({ method: "POST", path: `${params.id}/default` });
        return ok({ id: params.id, isDefault: true });
      }),
      http.delete("*/billing/business-profiles/:id", ({ params }) => {
        seen.push({ method: "DELETE", path: String(params.id) });
        return ok(null);
      }),
    );
    await api.createBusinessProfile({ name: "B", active: true, defaultPaymentTerms: "cash" as never, dueDateBasis: "invoice_created" });
    await api.updateBusinessProfile("bp-2", { logoAssetId: null });
    await api.setDefaultBusinessProfile("bp-2");
    await api.deleteBusinessProfile("bp-2");
    expect(seen).toEqual([
      { method: "POST", path: "", body: { name: "B", active: true, defaultPaymentTerms: "cash", dueDateBasis: "invoice_created" } },
      { method: "PUT", path: "bp-2", body: { logoAssetId: null } },
      { method: "POST", path: "bp-2/default" },
      { method: "DELETE", path: "bp-2" },
    ]);
  });

  it("surfaces a 409 on delete", async () => {
    server.use(
      http.delete("*/billing/business-profiles/:id", () =>
        HttpResponse.json(
          { success: false, error: { code: "CONFLICT", message: "Used by template Commercial" } },
          { status: 409 },
        ),
      ),
    );
    const err = (await api.deleteBusinessProfile("bp-2").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("Used by template Commercial");
  });
});
