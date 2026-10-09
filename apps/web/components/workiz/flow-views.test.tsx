import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WzFlowViews } from "./flow-views";

const STEPS = [
  { value: "hour", label: "hour" },
  { value: "day", label: "day" },
  { value: "week", label: "week" },
  { value: "month", label: "month" },
] as const;

describe("WzFlowViews", () => {
  it("is a radio group with the chosen step checked and the only Tab stop", () => {
    render(<WzFlowViews aria-label="Graph step" options={STEPS} value="hour" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Graph step" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "hour" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "hour" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "day" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "day" })).toHaveAttribute("tabindex", "-1");
  });

  it("chooses a step on click and moves with the arrow keys, round the ends", () => {
    const onChange = vi.fn();
    render(<WzFlowViews aria-label="Graph step" options={STEPS} value="hour" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "week" }));
    expect(onChange).toHaveBeenLastCalledWith("week");
    fireEvent.keyDown(screen.getByRole("radio", { name: "hour" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("day");
    fireEvent.keyDown(screen.getByRole("radio", { name: "hour" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("month");
  });

  it("draws Workiz's `_flowViews` box: 272×28, #ccc edge, 6px corners, the chosen part #ddd", () => {
    render(<WzFlowViews aria-label="Graph step" options={STEPS} value="day" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup");
    expect(group.className).toContain("w-[272px]");
    expect(group.className).toContain("rounded-[6px]");
    expect(screen.getByRole("radio", { name: "day" }).className).toContain("bg-[#dddddd]");
    expect(screen.getByRole("radio", { name: "month" }).className).not.toContain("border-r");
  });
});
