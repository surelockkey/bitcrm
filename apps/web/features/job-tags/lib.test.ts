import { describe, it, expect } from "vitest";
import { JOB_TAG_COLORS, type JobTag } from "@bitcrm/types";
import {
  jobTagName,
  jobTagMap,
  activeJobTags,
  jobTagsInCatalogOrder,
  sortJobTags,
  TAG_COLOR_CLASSES,
  tagSolidClasses,
} from "./lib";

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

/**
 * Workiz prints a job's tags in its catalog order — the order Filter results
 * lists them, oldest tag first — whatever order they were put on the job:
 * LSBE12 reads "waiting for an estimate · PLATINUM · BID/Solicitation" in the
 * list and in the job's header alike (list_01_submitted,
 * displayweb_wz_job_LSBE12), positions 16 · 58 · 126 of the 154 in
 * jobslist_wz_filter_open; all 744 multi-tag rows captured read that way. The
 * import gives each tag that place as `priority` (first of N → N), and the
 * job's own list is in no reliable order (dev holds LSBE12 the other way round).
 */
describe("jobTagsInCatalogOrder", () => {
  const catalog = [
    tag({ id: "bid", name: "BID/Solicitation", priority: 29 }),
    tag({ id: "plat", name: "PLATINUM", priority: 97 }),
    tag({ id: "wait", name: "waiting for an estimate", priority: 139 }),
    tag({ id: "mine", name: "Gate code", priority: 0 }),
    tag({ id: "ours", name: "After hours", priority: 0 }),
    tag({ id: "gone", name: "Old", priority: 50, active: false }),
  ];

  it("lays a job's tags out in catalog order, whatever order the job keeps them in", () => {
    const stored = ["bid", "plat", "wait"];
    expect(jobTagsInCatalogOrder(stored, catalog)).toEqual(["wait", "plat", "bid"]);
    expect(jobTagsInCatalogOrder(["plat", "wait", "bid"], catalog)).toEqual(["wait", "plat", "bid"]);
    expect(stored).toEqual(["bid", "plat", "wait"]);
  });

  it("puts tags made here after Workiz's, by name as the catalog does; an archived one keeps its place", () => {
    expect(jobTagsInCatalogOrder(["mine", "bid", "ours", "gone"], catalog)).toEqual(["gone", "bid", "ours", "mine"]);
  });

  it("leaves a tag the catalog does not know at the end, and the order alone until the catalog is in", () => {
    expect(jobTagsInCatalogOrder(["x", "bid", "wait"], catalog)).toEqual(["wait", "bid", "x"]);
    expect(jobTagsInCatalogOrder(["bid", "wait"], undefined)).toEqual(["bid", "wait"]);
    expect(jobTagsInCatalogOrder(undefined, catalog)).toEqual([]);
  });
});

/**
 * The job page "+" window lists the catalog newest first by default — Workiz
 * opens on "waiting for docs", "Kobi - Austin Sub", "NO EXACT TIME" … the
 * last tags it made (job_b_02_tags_add): the reverse of its catalog order.
 * Imported tags all carry the day of the import as `createdAt`, so among them
 * the catalog place decides (lowest `priority` = newest); a tag made here
 * since is newer than all of them.
 */
describe("sortJobTags", () => {
  const imported = "2026-09-30T00:00:00.000Z";
  const list = [
    tag({ id: "no-answer", name: "NO ANSWER", priority: 154, createdAt: imported }),
    tag({ id: "kobi", name: "Kobi - Austin Sub", priority: 2, createdAt: imported }),
    tag({ id: "docs", name: "waiting for docs", priority: 1, createdAt: imported }),
    tag({ id: "new", name: "Brand new", priority: 0, createdAt: "2026-10-05T10:00:00.000Z" }),
  ];
  const ids = (sort: Parameters<typeof sortJobTags>[1]) => sortJobTags(list, sort).map((t) => t.id);

  it("newest first: tags made here, then Workiz's newest to oldest", () => {
    expect(ids("newest")).toEqual(["new", "docs", "kobi", "no-answer"]);
  });

  it("oldest first is the catalog order", () => {
    expect(ids("oldest")).toEqual(["no-answer", "kobi", "docs", "new"]);
  });

  it("A-Z and Z-A go by name", () => {
    expect(ids("az")).toEqual(["new", "kobi", "no-answer", "docs"]);
    expect(ids("za")).toEqual(["docs", "no-answer", "kobi", "new"]);
  });

  it("leaves the list it was given alone", () => {
    sortJobTags(list, "newest");
    expect(list.map((t) => t.id)).toEqual(["no-answer", "kobi", "docs", "new"]);
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
