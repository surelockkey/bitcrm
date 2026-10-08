import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzTagFilter } from "./tag-filter";

const TAGS = [
  { id: "t1", name: "No answer", className: "bg-red-600" },
  { id: "t2", name: "Top priority", className: "bg-pink-600" },
];

describe("WzTagFilter", () => {
  it("shows every tag as a toggle, pressed when it filters", () => {
    render(<WzTagFilter tags={TAGS} selected={["t2"]} onToggle={() => {}} />);
    expect(screen.getByRole("group", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No answer" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Top priority" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("paints a tag its colour, and a chosen one Workiz's 75% black", () => {
    render(<WzTagFilter tags={TAGS} selected={["t2"]} onToggle={() => {}} />);
    const off = screen.getByRole("button", { name: "No answer" }).className;
    const on = screen.getByRole("button", { name: "Top priority" }).className;
    expect(off).toContain("bg-red-600");
    expect(off).toContain("uppercase");
    expect(off).toContain("text-[11px]");
    expect(on).toContain("bg-black/75");
    expect(on).not.toContain("bg-pink-600");
  });

  it("toggles a tag on a click", async () => {
    const onToggle = vi.fn();
    render(<WzTagFilter tags={TAGS} selected={[]} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "No answer" }));
    expect(onToggle).toHaveBeenCalledWith("t1");
  });

  it("keeps whatever follows the tags on their last line", () => {
    render(
      <WzTagFilter
        tags={TAGS}
        selected={[]}
        onToggle={() => {}}
        after={<span>All sources</span>}
      />,
    );
    expect(screen.getByText("All sources")).toBeInTheDocument();
  });
});
