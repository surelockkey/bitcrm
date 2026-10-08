import { describe, expect, it } from "vitest";
import { JobSuperStatus, type DealSubStatus } from "@bitcrm/types";
import { SUPER_PREFIX, STATUS_MENU_ORDER, statusMenuRows, statusMenuValue, superDotColor } from "./status-menu";

const sub = (id: string, name: string, group: JobSuperStatus, extra: Partial<DealSubStatus> = {}): DealSubStatus => ({
  id,
  name,
  group,
  color: "green",
  priority: 0,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...extra,
}) as DealSubStatus;

describe("status menu — our statuses in Workiz's menu", () => {
  it("lists the super-statuses in the order Workiz's menu does", () => {
    expect(STATUS_MENU_ORDER).toEqual([
      JobSuperStatus.SUBMITTED,
      JobSuperStatus.IN_PROGRESS,
      JobSuperStatus.CANCELED,
      JobSuperStatus.DONE,
      JobSuperStatus.PENDING,
      JobSuperStatus.DONE_PENDING_APPROVAL,
    ]);
    expect(statusMenuRows([]).map((r) => r.label)).toEqual([
      "Submitted",
      "In Progress",
      "Canceled",
      "Done",
      "Pending",
      "Done Pending Approval",
    ]);
  });

  it("files each active sub-status, indented, under its super-status", () => {
    const rows = statusMenuRows([
      sub("s1", "Job Accepted", JobSuperStatus.IN_PROGRESS),
      sub("s2", "Will Call Back", JobSuperStatus.CANCELED, { color: "red" }),
      sub("s3", "Old", JobSuperStatus.IN_PROGRESS, { active: false }),
    ]);
    expect(rows.map((r) => [r.kind, r.label])).toEqual([
      ["super", "Submitted"],
      ["super", "In Progress"],
      ["sub", "Job Accepted"],
      ["super", "Canceled"],
      ["sub", "Will Call Back"],
      ["super", "Done"],
      ["super", "Pending"],
      ["super", "Done Pending Approval"],
    ]);
    const willCall = rows.find((r) => r.label === "Will Call Back")!;
    expect(willCall).toMatchObject({ value: "s2", superStatus: JobSuperStatus.CANCELED, color: "red" });
  });

  // J11 — Workiz (job_b_02_status_open): "In progress" with sub-statuses is a
  // grey heading over its own "In progress" sub-status; "Submitted" and
  // "Done", which have none, are picked as they are.
  it("greys out a super-status that has sub-statuses, as Workiz does; one without stays selectable", () => {
    const rows = statusMenuRows([
      sub("s1", "In progress", JobSuperStatus.IN_PROGRESS),
      sub("s2", "Old", JobSuperStatus.PENDING, { active: false }),
    ]);
    expect(rows.find((r) => r.kind === "super" && r.superStatus === JobSuperStatus.IN_PROGRESS)).toMatchObject({
      value: `${SUPER_PREFIX}${JobSuperStatus.IN_PROGRESS}`,
      disabled: true,
    });
    expect(rows.find((r) => r.kind === "super" && r.superStatus === JobSuperStatus.SUBMITTED)).toMatchObject({ disabled: false });
    // Only active sub-statuses count.
    expect(rows.find((r) => r.kind === "super" && r.superStatus === JobSuperStatus.PENDING)).toMatchObject({ disabled: false });
    expect(rows.find((r) => r.kind === "sub")).toMatchObject({ label: "In progress", disabled: false });
  });

  it("names the selected row by sub-status when there is one, else by super-status", () => {
    expect(statusMenuValue({ superStatus: JobSuperStatus.CANCELED, subStatusId: "s2" })).toBe("s2");
    expect(statusMenuValue({ superStatus: JobSuperStatus.DONE })).toBe(`${SUPER_PREFIX}done`);
  });

  it("dots each super-status in Workiz's colour", () => {
    expect(superDotColor(JobSuperStatus.SUBMITTED)).toBe("#6aa8ee");
    expect(superDotColor(JobSuperStatus.IN_PROGRESS)).toBe("#d574e4");
    expect(superDotColor(JobSuperStatus.CANCELED)).toBe("#ff6f64");
    expect(superDotColor(JobSuperStatus.DONE)).toBe("#3acf7d");
    expect(superDotColor(JobSuperStatus.PENDING)).toBe("#fbab33");
    expect(superDotColor(JobSuperStatus.DONE_PENDING_APPROVAL)).toBe("#9ea6aa");
  });
});
