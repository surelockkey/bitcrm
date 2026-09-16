import { describe, it, expect } from "vitest";
import type { CallTag } from "@bitcrm/types";
import { activeCallTags, callTagMap, callTagName, tagColorClasses } from "./lib";

const tag = (over: Partial<CallTag> = {}): CallTag => ({
  id: "ct-1",
  name: "SPAM CALLER",
  color: "red",
  priority: 0,
  active: true,
  createdBy: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("callTagName", () => {
  it("resolves an id to its name", () => {
    expect(callTagName("ct-1", [tag()])).toBe("SPAM CALLER");
  });

  it("falls back to the raw id rather than an empty cell", () => {
    // 1.8M calls keep their tagIds; a tag purged out of the table still has to
    // show something on the rows that carry it.
    expect(callTagName("ct-gone", [tag()])).toBe("ct-gone");
  });

  it("dashes out an absent id", () => {
    expect(callTagName(undefined, [tag()])).toBe("—");
  });
});

describe("callTagMap", () => {
  it("is empty rather than undefined while the catalog loads", () => {
    expect(callTagMap(undefined).size).toBe(0);
  });
});

describe("activeCallTags", () => {
  it("drops archived tags — they name old calls but leave the pickers", () => {
    const out = activeCallTags([
      tag({ id: "ct-1", name: "Tech Call" }),
      tag({ id: "ct-2", name: "Lines Testing", active: false }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["ct-1"]);
  });

  it("sorts by priority first, then by name", () => {
    const out = activeCallTags([
      tag({ id: "a", name: "WRONG NUMBER", priority: 0 }),
      tag({ id: "b", name: "Tech Call", priority: 10 }),
      tag({ id: "c", name: "SPAM CALLER", priority: 0 }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
});

describe("tagColorClasses", () => {
  it("shares the job-tag palette so one chip style serves both catalogs", () => {
    expect(tagColorClasses("red")).toContain("red");
    // An imported row with a color nobody recognises still renders.
    expect(tagColorClasses("nope" as never)).toContain("slate");
  });
});
