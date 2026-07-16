import { describe, it, expect } from "vitest";
import type { Container } from "@bitcrm/types";
import { containerTitle } from "./lib";

describe("containerTitle", () => {
  it("uses the technician name", () => {
    expect(containerTitle({ technicianName: "Riley Santos" } as Container)).toBe("Riley Santos");
  });
  it("falls back when there's no name", () => {
    expect(containerTitle({ technicianName: "" } as Container)).toBe("Container");
  });
});
