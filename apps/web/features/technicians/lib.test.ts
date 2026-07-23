import { describe, it, expect } from "vitest";
import type { TechnicianSkill, User, OnboardingStatus } from "@bitcrm/types";
import { UserStatus } from "@bitcrm/types";
import {
  onboardingPct,
  techName,
  techUser,
  actorName,
  auditActorLabel,
  groupSkills,
  approvedValues,
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

describe("self fallback — a technician viewer can't fetch the user map (no users.view)", () => {
  const self = { id: "me1", firstName: "Sam", lastName: "Ochoa", email: "sam@slk" } as User;
  const mapped = { id: "me1", firstName: "Mapped", lastName: "Name", email: "m@slk" } as User;

  it("techUser falls back to the signed-in user for their own id", () => {
    expect(techUser("me1", new Map(), self)).toBe(self);
    expect(techUser("other", new Map(), self)).toBeUndefined();
  });
  it("the map wins over the self fallback", () => {
    expect(techUser("me1", new Map([["me1", mapped]]), self)).toBe(mapped);
  });
  it("techName resolves through the self fallback", () => {
    expect(techName("me1", new Map(), self)).toBe("Sam Ochoa");
    expect(techName("me1", new Map(), null)).toBe("Unknown technician");
  });
});

describe("auditActorLabel — prefers the server-resolved actorName", () => {
  const map = new Map<string, User>([
    ["u1", { id: "u1", firstName: "Riley", lastName: "Santos", email: "riley@slk" } as User],
  ]);
  it("uses actorName from the record when the backend provides it", () => {
    expect(auditActorLabel({ actorId: "nope", actorName: "Dana Reeves" }, map)).toBe("Dana Reeves");
  });
  it("falls back to the client-side join for older backends", () => {
    expect(auditActorLabel({ actorId: "u1" }, map)).toBe("Riley Santos");
    expect(auditActorLabel({ actorId: "nope" }, map)).toBe("Unknown user");
    expect(auditActorLabel({ actorId: undefined }, map)).toBe("Unknown user");
  });
});

describe("actorName — audit actors are any staff, not necessarily technicians", () => {
  const map = new Map<string, User>([
    ["u1", { id: "u1", firstName: "Riley", lastName: "Santos", email: "riley@slk" } as User],
    ["u3", { id: "u3", firstName: "", lastName: "", email: "ops@slk" } as User],
  ]);
  it("joins the actor name by id", () => {
    expect(actorName("u1", map)).toBe("Riley Santos");
  });
  it("falls back to the email when the name is empty", () => {
    expect(actorName("u3", map)).toBe("ops@slk");
  });
  it("says Unknown user (not technician) for an actor missing from the map", () => {
    expect(actorName("u2", map)).toBe("Unknown user");
  });
  it("handles records written without an actor id", () => {
    expect(actorName(undefined, map)).toBe("Unknown user");
    expect(actorName("", map)).toBe("Unknown user");
  });
  it("labels system-written records", () => {
    expect(actorName("system", map)).toBe("System");
  });
});

describe("skills grouping + assignability", () => {
  const skills: TechnicianSkill[] = [
    { skillId: "1", userId: "u1", type: "job_type", value: "Locksmith", status: "approved", proposedBy: "u1", proposedAt: "" },
    { skillId: "2", userId: "u1", type: "job_type", value: "Automotive", status: "pending", proposedBy: "u1", proposedAt: "" },
    { skillId: "3", userId: "u1", type: "service_area", value: "Phoenix", status: "approved", proposedBy: "u1", proposedAt: "" },
  ];

  it("splits job types and service areas", () => {
    const g = groupSkills(skills);
    expect(g.jobTypes).toHaveLength(2);
    expect(g.serviceAreas).toHaveLength(1);
  });
  it("lists approved values by type", () => {
    expect(approvedValues(skills, "job_type")).toEqual(["Locksmith"]);
  });
  it("is assignable with ≥1 approved job type and area", () => {
    expect(isAssignable(skills)).toBe(true);
  });
  it("is not assignable without an approved area", () => {
    expect(isAssignable(skills.filter((s) => s.type !== "service_area"))).toBe(false);
  });
});

describe("labels", () => {
  it("labels status and percentages", () => {
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("pending")).toBe("Pending");
    expect(formatPct(40)).toBe("40%");
  });
});
