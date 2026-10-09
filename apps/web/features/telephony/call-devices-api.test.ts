import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { listCallDevices } from "./call-devices-api";

/**
 * The Devices catalog came with the Forward targets; an API from before it
 * has no `/telephony/devices`. The builder, the groups and the Devices tab
 * all read the list, so a missing route reads as an empty catalog — never a
 * page stuck behind an error, never a retry that holds the page's skeleton.
 */
describe("listCallDevices", () => {
  it("reads the catalog", async () => {
    server.use(
      http.get("*/telephony/devices", () =>
        HttpResponse.json({ success: true, data: [{ id: "d1", name: "SURE CT LOCKSMITH", number: "+12039893585", type: "shop_line", active: true }] }),
      ),
    );
    expect((await listCallDevices()).map((d) => d.name)).toEqual(["SURE CT LOCKSMITH"]);
  });

  it("is empty on an API that has no Devices yet (404)", async () => {
    server.use(http.get("*/telephony/devices", () => HttpResponse.json({ success: false, message: "Cannot GET" }, { status: 404 })));
    expect(await listCallDevices()).toEqual([]);
  });

  it("still fails on anything else", async () => {
    server.use(http.get("*/telephony/devices", () => HttpResponse.json({ success: false, message: "boom" }, { status: 500 })));
    await expect(listCallDevices()).rejects.toThrow();
  });
});
