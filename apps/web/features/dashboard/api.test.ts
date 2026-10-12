import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { getComingUp } from "./api";

const visit = (id: string, slot: string, extra: Partial<Deal> = {}) =>
  ({
    id,
    contactId: `c-${id}`,
    scheduledDate: "2026-10-08",
    scheduledTimeSlot: slot,
    address: { street: "1 Main St", city: "Austin", state: "TX", zip: "" },
    ...extra,
  }) as Deal;

// Texas, booked for 10:00 CDT (= 11:00 EDT), and Connecticut at 10:30.
const tx = visit("tx", "10:00-11:00", { serviceAreaId: "sa-tx" });
const ct = visit("ct", "10:30-11:30");

function deals() {
  return http.get("*/deals", ({ request }) =>
    HttpResponse.json({
      success: true,
      data: new URL(request.url).searchParams.get("superStatus") === JobSuperStatus.SUBMITTED ? [tx, ct] : [],
      pagination: {},
    }),
  );
}

/**
 * 2026-10-12 owner rule: a visit is stored on the clock of the zone it was
 * booked in — the job's own, else its area's. Coming up reads the areas with
 * the visits, in the same request the dashboard waits for, so the card is
 * right in its first frame.
 */
describe("getComingUp", () => {
  it("orders the visits on their own zones' clocks and says which zone each is on", async () => {
    server.use(
      deals(),
      http.get("*/deals/service-areas", () =>
        HttpResponse.json({ success: true, data: [{ id: "sa-tx", name: "Austin", timezone: "America/Chicago" }] }),
      ),
    );
    const out = await getComingUp("2026-10-08");
    expect(out.deals.map((d) => d.id)).toEqual(["ct", "tx"]);
    expect(out.zones).toEqual({ ct: "America/New_York", tx: "America/Chicago" });
  });

  it("still answers when the areas cannot be read — a job's own zone still counts", async () => {
    server.use(
      deals(),
      http.get("*/deals/service-areas", () => HttpResponse.json({ success: false, message: "Forbidden" }, { status: 403 })),
    );
    const out = await getComingUp("2026-10-08");
    expect(out.deals.map((d) => d.id)).toEqual(["tx", "ct"]);
    expect(out.zones).toEqual({ ct: "America/New_York", tx: "America/New_York" });
  });
});
