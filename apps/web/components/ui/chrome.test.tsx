import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { Badge } from "./badge";
import { Card, CardTitle } from "./card";

const cls = (el: Element | null) => (el?.className ?? "").toString().split(/\s+/);

describe("a dropdown menu", () => {
  it("is Workiz's Actions menu: 216px, 2px corners, its two-part shadow, 50px slate rows ruled apart", () => {
    // job_b_02_actions_open: actionButton-module dropDownOptions.
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Job Done</DropdownMenuItem>
          <DropdownMenuItem>Delete Job</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const panel = document.querySelector("[data-slot=dropdown-menu-content]");
    expect(cls(panel)).toEqual(
      expect.arrayContaining([
        "min-w-[216px]",
        "rounded-[2px]",
        "shadow-[0_3px_6px_2px_rgba(0,0,0,0.18),0_4px_15px_2px_rgba(0,0,0,0.15)]",
      ]),
    );
    const item = screen.getByRole("menuitem", { name: "Job Done" });
    expect(cls(item)).toEqual(expect.arrayContaining(["min-h-[50px]", "px-[15px]", "text-wz-slate"]));
    expect(cls(panel)).toContain(
      "[&_[data-slot=dropdown-menu-item]+[data-slot=dropdown-menu-item]]:border-t",
    );
  });

  it("draws check items like react-select options: 14px rows, #deebff under the cursor", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Columns</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked>City</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitemcheckbox", { name: "City" });
    expect(cls(item)).toEqual(expect.arrayContaining(["py-2", "focus:bg-wz-option-focus"]));
  });
});

describe("a tooltip", () => {
  it("is Workiz's dark MUI chip: ink, 4px corners, 8px 12px, 12px/500 white, no arrow", () => {
    // uikit_wz_tooltip_top0 "Click to open dialer".
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>i</TooltipTrigger>
          <TooltipContent>Click to open dialer</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const tip = document.querySelector("[data-slot=tooltip-content]");
    expect(cls(tip)).toEqual(
      expect.arrayContaining(["bg-foreground", "rounded-[4px]", "px-3", "py-2", "text-xs", "font-medium", "text-white"]),
    );
    expect(tip?.querySelector("svg")).toBeNull();
  });
});

describe("a badge", () => {
  it("is Workiz's tag chip: 11px/500 on a 15px line, 1px 4px, solid", () => {
    // uikit_wz_set_team "2FA": 11px/500/13px white on #6aa8ee, r3, 1px 4px.
    render(<Badge variant="secondary">2FA</Badge>);
    expect(cls(screen.getByText("2FA"))).toEqual(
      expect.arrayContaining(["text-[11px]", "leading-[13px]", "px-1", "py-px", "bg-wz-link", "text-white"]),
    );
  });

  it("makes a destructive badge Workiz's solid red counter colour", () => {
    render(<Badge variant="destructive">Overdue</Badge>);
    expect(cls(screen.getByText("Overdue"))).toEqual(expect.arrayContaining(["bg-wz-danger", "text-white"]));
  });
});

describe("a card", () => {
  it("is Workiz's white card: 8px corners and the soft New Job shadow, no ring", () => {
    render(
      <Card data-testid="card">
        <CardTitle>Client</CardTitle>
      </Card>,
    );
    const card = screen.getByTestId("card");
    expect(cls(card)).toEqual(expect.arrayContaining(["rounded-[8px]", "shadow-[0_2px_8px_rgba(0,0,0,0.067)]"]));
    expect(cls(card)).not.toContain("ring-1");
    expect(cls(screen.getByText("Client"))).toEqual(expect.arrayContaining(["text-lg", "font-medium"]));
  });
});
