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
});
