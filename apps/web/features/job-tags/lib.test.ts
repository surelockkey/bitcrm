import { describe, it, expect } from "vitest";
import { JOB_TAG_COLORS, type JobTag } from "@bitcrm/types";
import { jobTagName, jobTagMap, activeJobTags, canCreateTag, TAG_COLOR_CLASSES } from "./lib";

const tag = (over: Partial<JobTag>): JobTag => ({
  id: "t-1",
  name: "Rush",
  color: "red",
  priority: 0,
  active: true,
  createdBy: "admin",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("jobTagName", () => {
  const catalog = [tag({ id: "t-1", name: "Rush" }), tag({ id: "t-2", name: "Repeat" })];

  it("resolves an id to its name", () => {
    expect(jobTagName("t-2", catalog)).toBe("Repeat");
  });
  it("falls back to the raw id for an unknown tag", () => {
    expect(jobTagName("t-x", catalog)).toBe("t-x");
  });
  it("renders a dash for a missing id", () => {
    expect(jobTagName(undefined, catalog)).toBe("—");
  });
  it("builds an id → tag map", () => {
    expect(jobTagMap(catalog).get("t-1")?.color).toBe("red");
  });
});

describe("activeJobTags", () => {
  it("drops archived tags and sorts by priority desc then name", () => {
    const list = activeJobTags([
      tag({ id: "a", name: "B", priority: 1 }),
      tag({ id: "b", name: "A", priority: 5 }),
      tag({ id: "c", name: "Z", priority: 5 }),
      tag({ id: "d", name: "Old", active: false }),
    ]);
    expect(list.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
});

describe("TAG_COLOR_CLASSES", () => {
  it("covers every palette token", () => {
    for (const color of JOB_TAG_COLORS) {
      expect(TAG_COLOR_CLASSES[color]).toBeTruthy();
    }
  });
});

describe("canCreateTag", () => {
  const catalog = [tag({ name: "Rush" }), tag({ name: "VIP" }), tag({ name: "Old", active: false })];

  it("is false for an empty or whitespace search", () => {
    expect(canCreateTag("", catalog)).toBe(false);
    expect(canCreateTag("   ", catalog)).toBe(false);
  });
  it("is false when a tag already has that name (case-insensitive, incl. archived)", () => {
    expect(canCreateTag("rush", catalog)).toBe(false);
    expect(canCreateTag("  VIP  ", catalog)).toBe(false);
    expect(canCreateTag("old", catalog)).toBe(false);
  });
  it("is true for a new, unused name", () => {
    expect(canCreateTag("Warranty", catalog)).toBe(true);
  });
  it("handles an empty catalog", () => {
    expect(canCreateTag("Anything", undefined)).toBe(true);
  });
});
