import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { WzMiniToggle, WzSwitchTabs } from "./switch-tabs";

describe("WzSwitchTabs", () => {
  const tabs = [
    { value: "jobs", label: "Jobs" },
    { value: "techs", label: "Techs" },
  ];

  it("marks the chosen tab and reports a pick", () => {
    const onChange = vi.fn();
    render(<WzSwitchTabs tabs={tabs} value="jobs" onChange={onChange} aria-label="Show" />);
    expect(screen.getByRole("tab", { name: "Jobs" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Techs" })).toHaveAttribute("aria-selected", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Techs" }));
    expect(onChange).toHaveBeenCalledWith("techs");
  });

  it("moves with the arrow keys", () => {
    const onChange = vi.fn();
    render(<WzSwitchTabs tabs={tabs} value="jobs" onChange={onChange} aria-label="Show" />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Jobs" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("techs");
  });
});

describe("WzMiniToggle", () => {
  it("is a switch named by its row's words", () => {
    const onChange = vi.fn();
    render(<WzMiniToggle label="Show techs" checked={false} onCheckedChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Show techs" });
    expect(sw).not.toBeChecked();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("can point at the words that explain it (the user page's Call masking ⓘ)", () => {
    render(
      <>
        <span id="why">{"They see the client's name, never the number."}</span>
        <WzMiniToggle label="Call masking" checked onCheckedChange={vi.fn()} aria-describedby="why" />
      </>,
    );
    expect(screen.getByRole("switch", { name: "Call masking" })).toHaveAccessibleDescription(
      "They see the client's name, never the number.",
    );
  });
});
