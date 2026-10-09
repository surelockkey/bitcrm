import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WzAccountTitle, WzAccountToggle, WzDocSettingsField, WzPayRow, WzPaySection } from "./settings-form";

describe("WzAccountTitle — the Account page's h3", () => {
  it("is a level-3 heading", () => {
    render(<WzAccountTitle>Account Preferences</WzAccountTitle>);
    expect(screen.getByRole("heading", { level: 3, name: "Account Preferences" })).toBeInTheDocument();
  });
});

describe("WzAccountToggle — an Account Preferences toggle row", () => {
  it("is a switch named by its words and described by its hint", () => {
    render(<WzAccountToggle label="Active" hint="Can be picked for new jobs." checked onCheckedChange={() => {}} />);
    const sw = screen.getByRole("switch", { name: "Active" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(sw).toHaveAccessibleDescription("Can be picked for new jobs.");
  });

  it("flips on a click, and not while disabled", async () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<WzAccountToggle label="Active" checked={false} onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "Active" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);

    onCheckedChange.mockClear();
    rerender(<WzAccountToggle label="Active" checked={false} onCheckedChange={onCheckedChange} disabled />);
    await userEvent.click(screen.getByRole("switch", { name: "Active" }));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe("WzPaySection / WzPayRow — Workiz Pay → My account", () => {
  it("a section is a region named by its title, with its grey line under it", () => {
    render(
      <WzPaySection title="Payment settings" subtitle="Customize the way your clients can pay">
        <WzPayRow label="Accept bank transfers (ACH)">
          <span>toggle</span>
        </WzPayRow>
      </WzPaySection>,
    );
    const region = screen.getByRole("region", { name: "Payment settings" });
    expect(region).toHaveTextContent("Customize the way your clients can pay");
    expect(region).toHaveTextContent("Accept bank transfers (ACH)");
    expect(region).toHaveTextContent("toggle");
  });

  it("a row with htmlFor labels its control", () => {
    render(
      <WzPayRow label="Bank minimum" htmlFor="bank-min">
        <input id="bank-min" />
      </WzPayRow>,
    );
    expect(screen.getByRole("textbox", { name: "Bank minimum" })).toBeInTheDocument();
  });
});

describe("WzDocSettingsField — the Document settings Subject / Message box", () => {
  it("labels its box and is described by its helper", () => {
    render(<WzDocSettingsField label="Message" helper="When you send via Email or SMS this will be the Message" defaultValue="Hi" />);
    const box = screen.getByRole("textbox", { name: "Message" });
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAccessibleDescription("When you send via Email or SMS this will be the Message");
  });

  it("can be a one-line box, and marks an error", () => {
    render(<WzDocSettingsField label="Subject" multiline={false} error="Required field" defaultValue="" />);
    const box = screen.getByRole("textbox", { name: "Subject" });
    expect(box.tagName).toBe("INPUT");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Required field")).toBeInTheDocument();
  });
});
