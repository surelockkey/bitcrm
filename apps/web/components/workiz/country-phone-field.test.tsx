import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzCountryPhoneField } from "./country-phone-field";

/**
 * Workiz's "+1 | Phone" pair on "Add team member"
 * (subcontractor_wz_04_add_new_user): a 123px country box and a 232px
 * floating-label Phone box 5px apart. Our rules inside: national digits as
 * you type, E.164 out, the country only changed by hand.
 */
describe("WzCountryPhoneField", () => {
  it("opens on +1 with an empty Phone box, both named for a screen reader", () => {
    render(<WzCountryPhoneField value="" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Country code" })).toBeInTheDocument();
    expect(screen.getByText("🇺🇸 +1")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("");
  });

  it("formats as you type and hands back E.164", async () => {
    const onChange = vi.fn();
    render(<WzCountryPhoneField value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Phone" }), "4045551234");
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("(404) 555-1234");
    expect(onChange).toHaveBeenLastCalledWith("+14045551234");
  });

  it("dials another country once picked", async () => {
    const onChange = vi.fn();
    render(<WzCountryPhoneField value="" onChange={onChange} />);
    await userEvent.type(screen.getByRole("combobox", { name: "Country code" }), "+380{Enter}");
    expect(screen.getByText("🇺🇦 +380")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Phone" }), "958601427");
    expect(onChange).toHaveBeenLastCalledWith("+380958601427");
  });

  it("says so once an unfinished number is left, and clears when emptied", async () => {
    const onChange = vi.fn();
    render(<WzCountryPhoneField value="" onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Phone" });
    await userEvent.type(box, "404");
    expect(screen.queryByText("Invalid phone number")).toBeNull();
    await userEvent.tab();
    expect(screen.getByText("Invalid phone number")).toBeInTheDocument();
    await userEvent.clear(box);
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("takes a value from outside — a reset, a loaded record", () => {
    const { rerender } = render(<WzCountryPhoneField value="" onChange={vi.fn()} />);
    rerender(<WzCountryPhoneField value="+15055550100" onChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "Phone" })).toHaveValue("(505) 555-0100");
  });

  it("lays the pair out 123px | 5px | the rest, as Workiz's", () => {
    const { container } = render(<WzCountryPhoneField value="" onChange={vi.fn()} />);
    expect(container.firstElementChild?.className).toContain("grid-cols-[123px_minmax(0,1fr)]");
    expect(container.firstElementChild?.className).toContain("gap-[5px]");
  });
});
