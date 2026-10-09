import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzFilterChip } from "./filter-chip";
import { WzTableEmpty } from "./table-empty";

describe("WzFilterChip", () => {
  it("is Workiz's two-part chip: the label in its colour, then its own × segment", async () => {
    const onRemove = vi.fn();
    render(<WzFilterChip label="tag: Needs a call" colorClassName="bg-[#e91e63]" onRemove={onRemove} />);
    const label = screen.getByText("tag: Needs a call");
    expect(label.className).toContain("text-[11.9px]");
    expect(label.parentElement!.className).toContain("bg-[#e91e63]");
    expect(label.parentElement!.className).toContain("text-white");
    await userEvent.click(screen.getByRole("button", { name: "Remove tag: Needs a call" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("is grey with dark words when the value has no colour of its own", () => {
    render(<WzFilterChip label="type: Lockout" onRemove={() => {}} />);
    const block = screen.getByText("type: Lockout").parentElement!;
    expect(block.className).toContain("bg-wz-disabled-border");
    expect(block.className).toContain("text-wz-value");
  });

  // The jobs list paints a service area in Workiz's own `bgcN` hex, which no
  // class carries.
  it("takes a colour of its own (a service area's #rrggbb) when the value has no class", () => {
    render(<WzFilterChip label="metro: Platinum_AL" color="#b8860b" onRemove={() => {}} />);
    const block = screen.getByText("metro: Platinum_AL").parentElement!;
    expect(block).toHaveStyle({ backgroundColor: "#b8860b" });
    expect(block.className).toContain("text-white");
    expect(block.className).not.toContain("bg-wz-disabled-border");
  });

  // jobslist_wz_filter_three: the 26px frame holds a 22px block 5px in from
  // either side (1px edge + 4px) and 2px from the top (1px edge + 1px).
  it("insets the coloured block 4px from the sides and 1px from the top and bottom of its frame", () => {
    render(<WzFilterChip label="tag: Needs a call" colorClassName="bg-[#e91e63]" onRemove={() => {}} />);
    const frame = screen.getByText("tag: Needs a call").parentElement!.parentElement!;
    expect(frame.className.split(/\s+/)).toEqual(expect.arrayContaining(["h-[26px]", "px-1", "py-px"]));
    expect(frame.className.split(/\s+/)).not.toContain("p-px");
  });
});

describe("WzTableEmpty", () => {
  it("washes the grid white and says so in Workiz's 20px words", () => {
    render(<WzTableEmpty title="No Jobs Found" data-testid="empty" />);
    const wash = screen.getByTestId("empty");
    expect(wash.className).toContain("bg-white/60");
    expect(screen.getByRole("heading", { name: "No Jobs Found" }).className).toContain("text-xl");
  });

  it("draws the picture above the words when given one", () => {
    render(<WzTableEmpty title="No Clients Found" art={<svg data-testid="art" />} />);
    expect(screen.getByTestId("art")).toBeInTheDocument();
  });

  // jobslist_wz_search_zzqxwv: the h3 lands 294px under the grid's top —
  // 145px, the 106px picture, then 44px (audit_pixels L2's fix on the jobs list).
  it("puts the words 44px under the picture", () => {
    render(<WzTableEmpty title="No Jobs Found" art={<svg data-testid="art" />} />);
    expect(screen.getByTestId("art").parentElement!.className).toContain("mb-[44px]");
  });

  // The grid's frame is the page's width (its columns scroll inside it —
  // `WzScrollGrid`), so the words centre on the frame and nothing pins
  // sideways: the `viewWidth` variant, which held the block on a page that
  // scrolled sideways itself, is gone with that page pattern (2026-10-09).
  it("centres its words on the grid as drawn and pins nothing sideways", () => {
    render(<WzTableEmpty title="No Jobs Found" />);
    const block = screen.getByRole("heading", { name: "No Jobs Found" }).parentElement!;
    expect(block.className).toContain("mx-auto");
    expect(block.className).not.toMatch(/\bsticky\b/);
    expect(block.style.width).toBe("");
  });
});
