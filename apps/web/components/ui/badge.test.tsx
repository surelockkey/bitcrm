import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

describe("a badge", () => {
  it("is a near-square label, the way Workiz draws its tags", () => {
    // Their tag chips are 14px tall with about two pixels of corner. Round
    // pills are for counters, not for labels.
    render(<Badge>Platinum</Badge>);
    const badge = screen.getByText("Platinum");
    expect(badge.className).toContain("rounded-chip");
    expect(badge.className).not.toContain("rounded-4xl");
    expect(badge.className).not.toContain("rounded-full");
  });
});
