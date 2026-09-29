import { describe, expect, it } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import { OPEN_SUPER_STATUSES, windowRequests } from "./window";

describe("windowRequests — a bounded board is a few bounded requests", () => {
  it("no dates → the open statuses, every date, in schedule order", () => {
    const reqs = windowRequests({});
    expect(reqs.map((r) => r.superStatus)).toEqual(OPEN_SUPER_STATUSES);
    expect(reqs[0]).toEqual({ superStatus: JobSuperStatus.SUBMITTED, sort: "schedule", dir: "asc", limit: 100 });
    expect(OPEN_SUPER_STATUSES).not.toContain(JobSuperStatus.DONE);
    expect(OPEN_SUPER_STATUSES).not.toContain(JobSuperStatus.CANCELED);
  });

  it("a date window → one merged request over every status", () => {
    expect(windowRequests({ from: "2026-09-21", to: "2026-09-27" })).toEqual([
      { scheduledFrom: "2026-09-21", scheduledTo: "2026-09-27", sort: "schedule", dir: "asc", limit: 100 },
    ]);
  });

  it("a date window with chosen statuses → one request per chosen status", () => {
    const reqs = windowRequests({ from: "2026-09-23", to: "2026-09-23", statuses: [JobSuperStatus.DONE, JobSuperStatus.PENDING] });
    expect(reqs).toEqual([
      { superStatus: JobSuperStatus.DONE, scheduledFrom: "2026-09-23", scheduledTo: "2026-09-23", sort: "schedule", dir: "asc", limit: 100 },
      { superStatus: JobSuperStatus.PENDING, scheduledFrom: "2026-09-23", scheduledTo: "2026-09-23", sort: "schedule", dir: "asc", limit: 100 },
    ]);
  });

  it("no dates with chosen statuses → only the open ones among them; a closed status needs a window", () => {
    const reqs = windowRequests({ statuses: [JobSuperStatus.DONE, JobSuperStatus.PENDING] });
    expect(reqs.map((r) => r.superStatus)).toEqual([JobSuperStatus.PENDING]);
  });

  it("a technician narrows every request", () => {
    for (const r of windowRequests({ from: "2026-09-23", to: "2026-09-23", techId: "t1" })) expect(r.techId).toBe("t1");
    for (const r of windowRequests({ techId: "t1" })) expect(r.techId).toBe("t1");
  });
});
