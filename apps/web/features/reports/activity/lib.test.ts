import { describe, expect, it } from "vitest";
import type { ActivityRow } from "@bitcrm/types";
import { activityCsv, activityParams, activityTime, activityUser } from "./lib";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "a1",
  timestamp: "2026-09-29T21:54:00.600Z",
  actorId: "u1",
  actorName: "(1) (Taylor) 12 Dispatcher",
  imported: true,
  text: "Added payment 465.46 in Installments",
  source: "web",
  jobRef: "EBKZ0I",
  ...over,
});

describe("Activity cells", () => {
  // 2026-10-12 owner rule: every time on the web is Connecticut's and says so.
  it("prints the time the way Workiz does, on Connecticut's clock, with the zone", () => {
    expect(activityTime("2026-09-29T21:54:00.600Z")).toBe("Tue Sep 29, 2026 05:54 pm EDT");
    expect(activityTime("2026-09-01T04:00:00.200Z")).toBe("Tue Sep 01, 2026 12:00 am EDT");
    // Winter: standard time.
    expect(activityTime("2026-12-01T15:00:00.000Z")).toBe("Tue Dec 01, 2026 10:00 am EST");
    // 03:30 UTC on Oct 13 is still Oct 12, 11:30 pm in Connecticut.
    expect(activityTime("2026-10-13T03:30:00.000Z")).toBe("Mon Oct 12, 2026 11:30 pm EDT");
  });

  it("keeps Workiz's name on an imported event and names our own from the directory", () => {
    const dir = (id: string) => (id === "u1" ? "Taylor Smith" : undefined);
    expect(activityUser(row(), dir)).toBe("(1) (Taylor) 12 Dispatcher");
    expect(activityUser(row({ imported: false, actorName: "taylor@x.com" }), dir)).toBe("Taylor Smith");
    expect(activityUser(row({ imported: false, actorId: "gone", actorName: "old@x.com" }), dir)).toBe("old@x.com");
  });

  it("asks for a period, people, a search and a direction", () => {
    expect(
      activityParams({ from: "2026-09-01", to: "2026-09-27", userIds: ["u1", "u2"], q: " Logged In ", sort: "asc" }, { limit: 10, cursor: "c1" }),
    ).toBe("from=2026-09-01&to=2026-09-27&userIds=u1%2Cu2&q=Logged+In&sort=asc&limit=10&cursor=c1");
    expect(activityParams({ from: "2026-09-29", to: "2026-09-29", userIds: [], q: "", sort: "desc" })).toBe(
      "from=2026-09-29&to=2026-09-29",
    );
  });

  it("exports Workiz's four columns, quoting what needs it — the time as the screen prints it", () => {
    const csv = activityCsv([row(), row({ text: 'Rescheduled job from "Tue", 4:00 pm', jobRef: undefined })], () => undefined);
    expect(csv.split("\n")).toEqual([
      "Time,User,Action,Job Id",
      '"Tue Sep 29, 2026 05:54 pm EDT",(1) (Taylor) 12 Dispatcher,Added payment 465.46 in Installments,EBKZ0I',
      '"Tue Sep 29, 2026 05:54 pm EDT",(1) (Taylor) 12 Dispatcher,"Rescheduled job from ""Tue"", 4:00 pm",',
    ]);
  });
});
