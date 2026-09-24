import { describe, it, expect } from "vitest";
import { JOB_TAG_COLORS, type JobTag } from "@bitcrm/types";
import { jobTagName, jobTagMap, activeJobTags, TAG_COLOR_CLASSES, tagSolidClasses } from "./lib";

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

/**
 * Workiz shows a job's tags as solid blocks in the tag's own colour, in
 * capitals, one under another — a dispatcher scanning the list reads colour
 * first and words second. Our subtle outlined pills read as decoration next to
 * them, so the jobs list uses the solid form.
 */
describe("tagSolidClasses", () => {
  it("fills the chip with the tag's colour and writes on it in white", () => {
    const cls = tagSolidClasses("blue");
    expect(cls).toContain("bg-blue-");
    expect(cls).toContain("text-white");
  });

  it("gives every colour in the palette a solid form", () => {
    for (const color of ["slate", "red", "amber", "green", "teal", "blue", "violet", "pink"] as const) {
      expect(tagSolidClasses(color)).toContain("text-white");
    }
  });

  it("falls back rather than rendering an unreadable chip", () => {
    expect(tagSolidClasses("chartreuse" as never)).toContain("text-white");
  });
});
