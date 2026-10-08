import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzButtonGroup } from "./button-group";

const BY = [
  { value: "created", label: "Created" },
  { value: "scheduled", label: "Scheduled" },
  { value: "end", label: "Closed" },
] as const;

const cls = (el: Element) => el.className.toString().split(/\s+/);

describe("WzButtonGroup", () => {
  it("is a radio group with the chosen one checked", () => {
    render(
      <WzButtonGroup
        aria-label="By Time"
        options={BY}
        value="end"
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("radiogroup", { name: "By Time" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Closed" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Created" })).not.toBeChecked();
  });

  it("draws Workiz's label.button: #ececec with a white rule, the chosen #ddd without one", () => {
    render(
      <WzButtonGroup
        aria-label="By Time"
        options={BY}
        value="scheduled"
        onChange={() => {}}
      />,
    );
    expect(cls(screen.getByRole("radio", { name: "Created" }))).toEqual(
      expect.arrayContaining([
        "h-8",
        "text-[13px]",
        "bg-[#ececec]",
        "border-r-2",
        "rounded-l-[2px]",
      ]),
    );
    expect(cls(screen.getByRole("radio", { name: "Scheduled" }))).toEqual(
      expect.arrayContaining(["bg-[#dddddd]", "text-wz-strong"]),
    );
    expect(cls(screen.getByRole("radio", { name: "Scheduled" }))).not.toContain(
      "border-r-2",
    );
    // Every one at rest keeps its rule, the last one too (Month, rep_jobstats_wz_02_overview_day).
    expect(cls(screen.getByRole("radio", { name: "Closed" }))).toEqual(
      expect.arrayContaining(["border-r-2", "rounded-r-[2px]"]),
    );
  });

  it("chooses on a click and walks with the arrow keys from a single Tab stop", async () => {
    const onChange = vi.fn();
    render(
      <WzButtonGroup
        aria-label="By Time"
        options={BY}
        value="end"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Created" }));
    expect(onChange).toHaveBeenLastCalledWith("created");

    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Closed" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("created");
    expect(screen.getByRole("radio", { name: "Created" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("end");
  });
});
