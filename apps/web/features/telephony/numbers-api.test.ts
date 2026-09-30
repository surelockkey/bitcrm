import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { updateNumberSettings } from "./numbers-api";

describe("updateNumberSettings", () => {
  it("sends only the keys being changed, so a company edit never clobbers the source", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.put("*/telephony/numbers/:phone/settings", async ({ request, params }) => {
        bodies.push({ phone: params.phone, body: await request.json() });
        return HttpResponse.json({ success: true, data: { phoneNumber: params.phone } });
      }),
    );
    await updateNumberSettings("+14045551234", { businessProfileId: "bp-2" });
    await updateNumberSettings("+14045551234", { sourceId: null });
    expect(bodies).toEqual([
      { phone: "+14045551234", body: { businessProfileId: "bp-2" } },
      { phone: "+14045551234", body: { sourceId: null } },
    ]);
  });
});
