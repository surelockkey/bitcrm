import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Select, SelectTrigger, SelectValue } from "./select";
import { Textarea } from "./textarea";

/**
 * Every field wears the same Workiz shape: white fill, a #cccccc rule and a
 * 4px corner, so a row of an input, a select and a textarea lines up.
 */
describe("field shapes agree", () => {
  it("gives the textarea the field's fill and corner", () => {
    render(<Textarea aria-label="Note" />);
    const box = screen.getByLabelText("Note");
    expect(box.className).toContain("rounded-md");
    expect(box.className).toContain("bg-card");
    expect(box.className).not.toContain("rounded-lg");
    expect(box.className).not.toMatch(/(^|\s)bg-transparent(\s|$)/);
  });

  it("gives the select trigger the same height as an input", () => {
    render(
      <Select>
        <SelectTrigger aria-label="Page size">
          <SelectValue placeholder="50" />
        </SelectTrigger>
      </Select>,
    );
    const trigger = screen.getByLabelText("Page size");
    expect(trigger.className).toContain("h-10");
    expect(trigger.className).toContain("rounded-md");
    expect(trigger.className).toContain("bg-card");
    // Standalone: the small variant keeps its own `data-[size=sm]:h-8`.
    expect(trigger.className).not.toMatch(/(^|\s)h-8(\s|$)/);
  });
});
