import { afterEach, describe, expect, it, vi } from "vitest";
import { readHidden, writeHidden } from "./hidden-widgets";

/**
 * Workiz's "Dashboard widgets" panel and the kebab's "Remove": which widgets
 * this person has taken off their dashboard. Kept per user in this browser,
 * as the jobs list keeps its Visible fields.
 */
describe("hidden widgets", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("starts with nothing hidden", () => {
    expect(readHidden("u1")).toEqual([]);
  });

  it("remembers what one user hid, and only for them", () => {
    writeHidden("u1", ["sales", "today"]);
    expect(readHidden("u1")).toEqual(["sales", "today"]);
    expect(readHidden("u2")).toEqual([]);
  });

  it("shrugs off a corrupt or foreign value", () => {
    localStorage.setItem("bitcrm:dashboard:hidden:u1", "{not json");
    expect(readHidden("u1")).toEqual([]);
    localStorage.setItem("bitcrm:dashboard:hidden:u1", JSON.stringify({ a: 1 }));
    expect(readHidden("u1")).toEqual([]);
    localStorage.setItem("bitcrm:dashboard:hidden:u1", JSON.stringify(["sales", 3]));
    expect(readHidden("u1")).toEqual(["sales"]);
  });

  it("never throws when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readHidden("u1")).toEqual([]);
    expect(() => writeHidden("u1", ["sales"])).not.toThrow();
  });
});
