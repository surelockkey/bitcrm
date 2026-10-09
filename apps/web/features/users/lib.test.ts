import { describe, expect, it } from "vitest";
import { createdUserMessage } from "./lib";

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
