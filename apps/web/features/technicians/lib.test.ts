import { describe, it, expect } from "vitest";
import type {
  TechnicianJobType,
  TechnicianServiceArea,
  User,
  OnboardingStatus,
} from "@bitcrm/types";
import { UserStatus } from "@bitcrm/types";
import {
  onboardingPct,
  techName,
  approvedJobTypeIds,
  approvedServiceAreaIds,
  isAssignable,
  statusLabel,
  formatPct,
} from "./lib";

describe("onboardingPct", () => {
  it("computes a percentage from steps", () => {
    expect(onboardingPct({ completedSteps: 3, totalSteps: 3 } as OnboardingStatus)).toBe(100);
    expect(onboardingPct({ completedSteps: 2, totalSteps: 3 } as OnboardingStatus)).toBe(67);
    expect(onboardingPct({ completedSteps: 0, totalSteps: 0 } as OnboardingStatus)).toBe(0);
  });
});

describe("techName — profiles have no name, so join with Users", () => {
  const map = new Map<string, User>([
    ["u1", { id: "u1", firstName: "Riley", lastName: "Santos", email: "riley@slk" } as User],
  ]);
  it("joins the user name by id", () => {
    expect(techName("u1", map)).toBe("Riley Santos");
  });
  it("falls back when the user isn't loaded", () => {
    expect(techName("u2", map)).toBe("Unknown technician");
  });
  void UserStatus;
});

describe("assignment approvals + assignability", () => {
  const jobTypes: TechnicianJobType[] = [
    { userId: "u1", jobTypeId: "jt-locksmith", status: "approved", proposedBy: "u1", proposedAt: "" },
    { userId: "u1", jobTypeId: "jt-automotive", status: "pending", proposedBy: "u1", proposedAt: "" },
  ];
  const serviceAreas: TechnicianServiceArea[] = [
    { userId: "u1", serviceAreaId: "sa-phoenix", status: "approved", proposedBy: "u1", proposedAt: "" },
  ];

  it("lists approved job-type ids", () => {
    expect(approvedJobTypeIds(jobTypes)).toEqual(["jt-locksmith"]);
  });
  it("lists approved service-area ids", () => {
    expect(approvedServiceAreaIds(serviceAreas)).toEqual(["sa-phoenix"]);
  });
  it("is assignable with ≥1 approved job type and area", () => {
    expect(isAssignable(jobTypes, serviceAreas)).toBe(true);
  });
  it("is not assignable without an approved area", () => {
    expect(isAssignable(jobTypes, [])).toBe(false);
  });
});

describe("labels", () => {
  it("labels status and percentages", () => {
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("pending")).toBe("Pending");
    expect(formatPct(40)).toBe("40%");
  });
});
