import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzTabBar } from "./tab-bar";

const TABS = [
  { value: "jobs", label: "Jobs", count: 1 },
  { value: "estimates", label: "Estimates", count: 0 },
  { value: "calls", label: "Calls" },
];

const cls = (el: Element) => el.className.toString().split(/\s+/);

describe("WzTabBar", () => {
  it("is a tablist; the open tab is selected and the only one in the Tab order", () => {
    render(<WzTabBar aria-label="Client" tabs={TABS} value="estimates" onValueChange={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(screen.getByRole("tablist", { name: "Client" })).toBeInTheDocument();
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("moves with the arrow keys, Home and End, wrapping round, and picks as it goes", async () => {
    const onValueChange = vi.fn();
    render(<WzTabBar aria-label="Client" tabs={TABS} value="jobs" onValueChange={onValueChange} />);
    screen.getByRole("tab", { name: /Jobs/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onValueChange).toHaveBeenLastCalledWith("estimates");
    expect(screen.getByRole("tab", { name: /Estimates/ })).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(onValueChange).toHaveBeenLastCalledWith("calls");
    await userEvent.keyboard("{ArrowRight}");
    expect(onValueChange).toHaveBeenLastCalledWith("jobs");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onValueChange).toHaveBeenLastCalledWith("calls");
    await userEvent.keyboard("{Home}");
    expect(onValueChange).toHaveBeenLastCalledWith("jobs");
  });

  it("draws the small tabs (client page): 13px, slate at rest, ink 600 and a 2px bar when open, grey counters", () => {
    render(<WzTabBar aria-label="Client" tabs={TABS} value="jobs" onValueChange={() => {}} />);
    const open = screen.getByRole("tab", { name: /Jobs/ });
    expect(cls(open)).toEqual(expect.arrayContaining(["text-[13px]", "font-semibold", "text-foreground"]));
    expect(cls(screen.getByRole("tab", { name: /Calls/ }))).toEqual(expect.arrayContaining(["font-medium", "text-wz-slate"]));
    expect(open.querySelector("[data-slot=wz-tab-bar-line]")).not.toBeNull();
    // uikit_wz_client_page: 20px #dfe2e3 counter, 11px/600 ink.
    expect(cls(screen.getByText("1"))).toEqual(expect.arrayContaining(["bg-border", "text-[11px]", "font-semibold"]));
    // A tab without a count draws no counter at all.
    expect(screen.getByRole("tab", { name: /Calls/ }).querySelector("[data-slot=wz-tab-count]")).toBeNull();
  });

  it("draws the big page tabs (Price book): 16px, a 3px bar", () => {
    render(<WzTabBar variant="page" aria-label="Price book" tabs={TABS} value="jobs" onValueChange={() => {}} />);
    const open = screen.getByRole("tab", { name: /Jobs/ });
    expect(cls(open)).toEqual(expect.arrayContaining(["text-base", "font-semibold"]));
    expect(cls(open.querySelector("[data-slot=wz-tab-bar-line]")!)).toContain("h-[3px]");
  });

  it("draws the job page's two-line tabs: a 12px line under each name, equal widths, a 4px bar", () => {
    render(
      <WzTabBar
        variant="job"
        aria-label="Job sections"
        tabs={[
          { value: "details", label: "Details", sublabel: "Lockout" },
          { value: "payments", label: "Payments", sublabel: "$0.00 balance" },
        ]}
        value="details"
        onValueChange={() => {}}
      />,
    );
    const open = screen.getByRole("tab", { name: "Details" });
    expect(open).toHaveAccessibleDescription("Lockout");
    expect(cls(open)).toContain("flex-1");
    expect(cls(open.querySelector("[data-slot=wz-tab-bar-line]")!)).toContain("h-1");
  });
});
