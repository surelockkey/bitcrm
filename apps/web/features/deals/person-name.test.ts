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

/**
 * Workiz prints a teammate by the whole name it keeps for them, group and
 * region prefix included ("(2) TX - Daniel Munoz"), on every tech chip, in
 * the Team rows and in Assign A Tech. The import keeps that name beside the
 * split first / last (`User.workizName`); someone made here, or renamed here
 * since, has none and reads as first + last.
 */
describe("personName — the Workiz name first", () => {
  const daniel = { firstName: "Daniel", lastName: "Munoz", workizName: "(2) TX - Daniel Munoz" };

  it("prints the name exactly as Workiz does when the person has one", () => {
    expect(personName(daniel)).toBe("(2) TX - Daniel Munoz");
  });

  it("collapses the double spaces a few Workiz names carry, as the page would", () => {
    expect(personName({ firstName: "John", lastName: "Egan", workizName: " (2) John  Egan " })).toBe("(2) John Egan");
  });

  it("falls back to first + last without one, or with a blank one", () => {
    expect(personName({ firstName: "Daniel", lastName: "Munoz" })).toBe("Daniel Munoz");
    expect(personName({ ...daniel, workizName: "  " })).toBe("Daniel Munoz");
  });
});
