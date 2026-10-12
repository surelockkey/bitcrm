import { describe, expect, it } from "vitest";
import { createdUserMessage, formatDate } from "./lib";

/** 2026-10-12 owner rule: the web's days are Connecticut's, whatever the browser's. */
describe("formatDate", () => {
  it("prints an instant's day on Connecticut's calendar — no time, so no zone label", () => {
    expect(formatDate("2026-10-12T13:34:39.000Z")).toBe("Oct 12, 2026");
    expect(formatDate("2026-12-01T15:00:00.000Z")).toBe("Dec 1, 2026");
    // 03:30 UTC on Oct 13 is 11:30 pm EDT on Oct 12 (and already the 13th in Kyiv).
    expect(formatDate("2026-10-13T03:30:00.000Z")).toBe("Oct 12, 2026");
  });

  it("prints a bare day as it is — never shifted a day by a zone", () => {
    expect(formatDate("2026-10-12")).toBe("Oct 12, 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("a dash for nothing or nonsense", () => {
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });
});

describe("createdUserMessage", () => {
  it("a User was invited by email", () => {
    expect(createdUserMessage({ email: "a@b.com", firstName: "Ann", lastName: "Lee" })).toBe("Invite sent to a@b.com");
  });

  it("a subcontractor was added — nobody was invited (Workiz: they cannot log in)", () => {
    expect(
      createdUserMessage({ email: "t@s.com", firstName: "Tyler", lastName: "Smith", userType: "subcontractor" }),
    ).toBe("Tyler Smith added as a subcontractor");
  });
});
