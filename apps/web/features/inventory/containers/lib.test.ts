import { describe, it, expect } from "vitest";
import type { Container } from "@bitcrm/types";
import { containerTitle } from "./lib";

describe("containerTitle", () => {
  it("uses the container's own name", () => {
    expect(
      containerTitle({ name: "Van 1", technicianName: "Riley Santos" } as Container),
    ).toBe("Van 1");
  });
  it("falls back to the technician name for legacy rows", () => {
    expect(containerTitle({ name: "", technicianName: "Riley Santos" } as Container)).toBe(
      "Riley Santos",
    );
  });
  it("falls back when there's no name at all", () => {
    expect(containerTitle({ name: "", technicianName: "" } as Container)).toBe("Container");
  });
});
