import { describe, it, expect } from "vitest";
import type { JobSource } from "@bitcrm/types";
import { jobSourceName, jobSourceNameMap, activeJobSources } from "./lib";

const jt = (over: Partial<JobSource>): JobSource => ({
  id: "jt-1",
  name: "Lockout",
  priority: 0,
  active: true,
  createdBy: "admin",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("jobSourceName", () => {
  const catalog = [jt({ id: "jt-1", name: "Lockout" }), jt({ id: "jt-2", name: "Rekey" })];

  it("resolves an id to its name", () => {
    expect(jobSourceName("jt-2", catalog)).toBe("Rekey");
  });
  it("falls back to the raw id for an unknown type", () => {
    expect(jobSourceName("jt-x", catalog)).toBe("jt-x");
  });
  it("renders a dash for a missing id", () => {
    expect(jobSourceName(undefined, catalog)).toBe("—");
  });
  it("builds a lookup map", () => {
    expect(jobSourceNameMap(catalog).get("jt-1")).toBe("Lockout");
  });
});

describe("activeJobSources", () => {
  it("drops archived types and sorts by priority desc then name", () => {
    const list = activeJobSources([
      jt({ id: "a", name: "B", priority: 1 }),
      jt({ id: "b", name: "A", priority: 5 }),
      jt({ id: "c", name: "Z", priority: 5 }),
      jt({ id: "d", name: "Old", active: false }),
    ]);
    expect(list.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
});
