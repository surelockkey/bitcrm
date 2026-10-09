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

  // The jobs list with a "status: Done" chip underlines no tab (Workiz has no
  // Done tab); the row must still be reachable from the keyboard.
  it("keeps the first tab in the Tab order when none is open", () => {
    render(<WzTabBar aria-label="Job status" tabs={TABS} value="done" onValueChange={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([0, -1, -1]);
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

  it("draws the legacy report tabs (Job Statistics): 16px medium open or not, 45px sides, a 4px bar at the foot", () => {
    render(<WzTabBar variant="legacy" aria-label="Job Statistics" tabs={TABS} value="jobs" onValueChange={() => {}} />);
    const open = screen.getByRole("tab", { name: /Jobs/ });
    expect(cls(open)).toEqual(expect.arrayContaining(["text-base", "font-medium", "px-[45px]"]));
    expect(cls(screen.getByRole("tab", { name: /Calls/ }))).toEqual(expect.arrayContaining(["font-medium", "text-foreground"]));
    expect(cls(open.querySelector("[data-slot=wz-tab-bar-line]")!)).toEqual(expect.arrayContaining(["h-1", "bottom-0"]));
  });

  it("draws the job page's two-line tabs: a 12px line under each name, a ninth of the bar each, a 4px bar over the rule", () => {
    render(
      <WzTabBar
        variant="job"
        aria-label="Job sections"
        tabs={[
          { value: "details", label: "Details", sublabel: "Lockout", id: "job-tab-details" },
          { value: "payments", label: "Payments", sublabel: "$0.00 balance" },
        ]}
        value="details"
        onValueChange={() => {}}
      />,
    );
    const open = screen.getByRole("tab", { name: "Details" });
    expect(open).toHaveAccessibleDescription("Lockout");
    // A tabpanel names its tab by id (aria-labelledby); the grey line's id follows it.
    expect(open).toHaveAttribute("id", "job-tab-details");
    expect(screen.getByText("Lockout")).toHaveAttribute("id", "job-tab-details-sub");
    // Workiz's nine tabs share the bar (149px each on 1345, job_b_01); ours
    // keep that width so each name lands where Workiz's does, and with the
    // Timeline open a tab grows to its text plus 18px a side (rail_chat) —
    // the grey line is never cut to "…" (features/deals job-tab-bar.test).
    expect(cls(open)).toEqual(expect.arrayContaining(["w-[calc(100%/9)]", "min-w-max", "px-[18px]"]));
    expect(cls(open)).not.toContain("flex-1");
    const sub = screen.getByText("$0.00 balance");
    expect(cls(sub)).toContain("whitespace-nowrap");
    expect(cls(sub)).not.toContain("truncate");
    expect(cls(open.querySelector("[data-slot=wz-tab-bar-line]")!)).toEqual(expect.arrayContaining(["h-1", "bottom-0"]));
    // 89px: the 88px bar plus the #cad3d6 rule drawn inside it, so the open
    // tab's bar covers the rule (audit_pixels J7: Workiz 389–392 over 392).
    expect(cls(screen.getByRole("tablist"))).toEqual(
      expect.arrayContaining(["h-[89px]", "shadow-[inset_0_-1px_0_var(--wz-rule)]"]),
    );
  });

  // list_01_submitted / uikit_wz_client_page: the row is 43px from its top to
  // the strip under it — the #c4c4c4 rule is the row's own last pixel row and
  // the open tab's 2px bar covers it (audit_pixels L19), not a border below.
  it("small tabs: the rule inside the row, the open tab's 2px bar over it", () => {
    render(<WzTabBar aria-label="Client" tabs={TABS} value="jobs" onValueChange={() => {}} />);
    const list = screen.getByRole("tablist");
    expect(cls(list)).toContain("shadow-[inset_0_-1px_0_var(--wz-tab-rule)]");
    expect(cls(list)).not.toContain("border-b");
    const line = screen.getByRole("tab", { name: /Jobs/ }).querySelector("[data-slot=wz-tab-bar-line]")!;
    expect(cls(line)).toEqual(expect.arrayContaining(["bottom-0", "h-0.5"]));
  });
});
