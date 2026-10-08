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

  it("wears Workiz's field edge: #ccc, darker hovered, the yellow edge focused", () => {
    // react-select / sajInput (uikit_wz_pb_addnew, formkit_focus_empty): a
    // 1px #ccc rule, #b3b3b3 under the cursor, #ffd400 while typing — no
    // blue glow.
    render(<Input aria-label="Name" />);
    const cls = screen.getByLabelText("Name").className.split(/\s+/);
    expect(cls).toEqual(
      expect.arrayContaining(["border-input", "hover:border-wz-field-hover", "focus-visible:border-wz-focus"]),
    );
    expect(cls).not.toContain("focus-visible:ring-3");
    expect(cls).toContain("placeholder:text-wz-placeholder");
  });

  it("greys a disabled field like Workiz's disabled select instead of fading it", () => {
    render(<Input aria-label="Locked" disabled />);
    const cls = screen.getByLabelText("Locked").className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["disabled:bg-wz-disabled", "disabled:border-wz-disabled-border"]));
    expect(cls).not.toContain("disabled:opacity-50");
  });

  it("marks an invalid field with Workiz's error red", () => {
    render(<Input aria-label="Email" aria-invalid />);
    expect(screen.getByLabelText("Email").className).toContain("aria-invalid:border-wz-error");
  });
});
