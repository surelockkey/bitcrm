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
  it("prints the time the way Workiz does, on the account's clock", () => {
    expect(activityTime("2026-09-29T21:54:00.600Z")).toBe("Tue Sep 29, 2026 05:54 pm");
    expect(activityTime("2026-09-01T04:00:00.200Z")).toBe("Tue Sep 01, 2026 12:00 am");
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

  it("exports Workiz's four columns, quoting what needs it", () => {
    const csv = activityCsv([row(), row({ text: 'Rescheduled job from "Tue", 4:00 pm', jobRef: undefined })], () => undefined);
    expect(csv.split("\n")).toEqual([
      "Time,User,Action,Job Id",
      '"Tue Sep 29, 2026 05:54 pm",(1) (Taylor) 12 Dispatcher,Added payment 465.46 in Installments,EBKZ0I',
      '"Tue Sep 29, 2026 05:54 pm",(1) (Taylor) 12 Dispatcher,"Rescheduled job from ""Tue"", 4:00 pm",',
    ]);
  });
});
