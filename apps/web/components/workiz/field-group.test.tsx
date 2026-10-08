import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WzFieldGroup } from "./field-group";
import { WzTextField } from "./text-field";

function boxes() {
  const a = screen.getByLabelText("A");
  const b = screen.getByLabelText("B");
  return {
    a,
    b,
    aWrap: a.closest("[data-slot=wz-text-field]") as HTMLElement,
    bWrap: b.closest("[data-slot=wz-text-field]") as HTMLElement,
  };
}

describe("WzFieldGroup", () => {
  it("draws Phone | Ext as one seamless box: the second laps 2px over, with no left edge", () => {
    render(
      <WzFieldGroup join="seamless">
        <WzTextField label="A" />
        <WzTextField label="B" className="w-[100px] flex-none" />
      </WzFieldGroup>,
    );
    const { a, b, aWrap, bWrap } = boxes();
    // Members share the row; a width on one (Ext) wins over the default grow.
    expect(aWrap.className).toMatch(/(^|\s)flex-1(\s|$)/);
    expect(bWrap.className).toContain("flex-none");
    expect(bWrap.className).not.toMatch(/(^|\s)flex-1(\s|$)/);
    // No overhang inside a group: the boxes meet edge to edge.
    expect(a.className).not.toContain("w-[calc(100%+2px)]");
    expect(aWrap.className).not.toContain("-ml-");
    expect(a.className).not.toContain("border-l-0");
    expect(bWrap.className).toContain("-ml-0.5");
    expect(bWrap.className).toContain("w-[100px]");
    expect(b.className).toContain("border-l-0");
    // The left edge stays off while Ext is focused, as Workiz's noBorderLeft.
    expect(b.className).toContain("focus:border-l-0");
  });

  it("shares one 1px edge for First | Last Name", () => {
    render(
      <WzFieldGroup join="line">
        <WzTextField label="A" />
        <WzTextField label="B" />
      </WzFieldGroup>,
    );
    const { b, bWrap } = boxes();
    expect(bWrap.className).toContain("-ml-px");
    expect(b.className).not.toContain("border-l-0");
  });

  it("keeps the job page's soft #cad3d6 divider through focus", () => {
    render(
      <WzFieldGroup join="soft">
        <WzTextField label="A" />
        <WzTextField label="B" />
      </WzFieldGroup>,
    );
    const { b, bWrap } = boxes();
    expect(bWrap.className).toContain("-ml-px");
    expect(b.className).toContain("border-l-wz-rule");
    expect(b.className).toContain("focus:border-l-wz-rule");
  });

  it("leaves a field outside any group alone", () => {
    render(<WzTextField label="A" />);
    const a = screen.getByLabelText("A");
    expect(a.closest("[data-slot=wz-text-field]")!.className).not.toContain("-ml-");
  });
});
