import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "./input";

describe("an input", () => {
  it("matches the Workiz field: 40px tall, white, a 4px corner", () => {
    // Sampled from their jobs screen — the search field is 40px over a
    // #cccccc rule, filled white even when it sits on the grey strip.
    render(<Input aria-label="Search" />);
    const input = screen.getByLabelText("Search");
    expect(input.className).toContain("h-10");
    expect(input.className).toContain("rounded-md");
    expect(input.className).toContain("bg-card");
    expect(input.className).not.toContain("h-8");
    // Standalone, not the `file:bg-transparent` that stays.
    expect(input.className).not.toMatch(/(^|\s)bg-transparent(\s|$)/);
  });
});
