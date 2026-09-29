import { describe, it, expect } from "vitest";
import { personName } from "./person-name";

/**
 * A uuid is not a name. The directory arrives a moment after the rows do, and
 * several screens filled that moment by printing the raw id — unreadable, and
 * it looks broken. `useUserMap` already goes out of its way to avoid exactly
 * that; everywhere that shows a person should too.
 */
describe("personName", () => {
  it("gives the name when the directory has it", () => {
    expect(personName({ firstName: "Yeter", lastName: "Mizrahi" })).toBe("Yeter Mizrahi");
  });

  it("copes with half a name", () => {
    expect(personName({ firstName: "Kobi", lastName: "" })).toBe("Kobi");
    expect(personName({ firstName: "", lastName: "Szender" })).toBe("Szender");
  });

  it("falls back to the email rather than to nothing", () => {
    expect(personName({ firstName: "", lastName: "", email: "ann@example.com" })).toBe("ann@example.com");
  });

  it("gives nothing at all rather than an id", () => {
    expect(personName(undefined)).toBeUndefined();
    expect(personName({ firstName: "", lastName: "" })).toBeUndefined();
  });

  it("does not hand back whitespace dressed up as a name", () => {
    expect(personName({ firstName: "  ", lastName: " " })).toBeUndefined();
  });
});
