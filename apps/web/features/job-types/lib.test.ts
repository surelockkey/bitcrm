import { describe, it, expect } from "vitest";
import type { JobType } from "@bitcrm/types";
import { jobTypeName, jobTypeNameMap, activeJobTypes } from "./lib";

const jt = (over: Partial<JobType>): JobType => ({
  id: "jt-1",
  name: "Lockout",
  priority: 0,
  active: true,
  createdBy: "admin",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("jobTypeName", () => {
  const catalog = [jt({ id: "jt-1", name: "Lockout" }), jt({ id: "jt-2", name: "Rekey" })];

  it("resolves an id to its name", () => {
    expect(jobTypeName("jt-2", catalog)).toBe("Rekey");
  });
  it("falls back to the raw id for an unknown type", () => {
    expect(jobTypeName("jt-x", catalog)).toBe("jt-x");
  });
  it("renders a dash for a missing id", () => {
    expect(jobTypeName(undefined, catalog)).toBe("—");
  });
  it("builds a lookup map", () => {
    expect(jobTypeNameMap(catalog).get("jt-1")).toBe("Lockout");
  });
});

describe("activeJobTypes", () => {
  it("drops archived types and sorts by priority desc then name", () => {
    const list = activeJobTypes([
      jt({ id: "a", name: "B", priority: 1 }),
      jt({ id: "b", name: "A", priority: 5 }),
      jt({ id: "c", name: "Z", priority: 5 }),
      jt({ id: "d", name: "Old", active: false }),
    ]);
    expect(list.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
});
