import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneInput } from "./phone-input";

/** Controlled wrapper mirroring how forms bind the input; exposes the E.164 value. */
function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PhoneInput value={value} onChange={setValue} />
      <output data-testid="e164">{value}</output>
    </>
  );
}

const input = () => screen.getByPlaceholderText<HTMLInputElement>("Phone number");
const countryButton = () => screen.getByRole("button", { name: /Country code/ });

describe("PhoneInput", () => {
  it("defaults to the US and formats typed digits nationally — no +1 in the field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(input(), "4045551234");
    expect(input()).toHaveValue("(404) 555-1234");
    expect(screen.getByTestId("e164")).toHaveTextContent("+14045551234");
    expect(countryButton()).toHaveAccessibleName(/United States \+1/);
  });

  it("strips the +1 from a pasted number instead of showing it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(input());
    await user.paste("+1 (404) 555-1234");
    expect(input()).toHaveValue("(404) 555-1234");
    expect(screen.getByTestId("e164")).toHaveTextContent("+14045551234");
  });

  it("strips a leading 1 from an 11-digit paste", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(input());
    await user.paste("1-404-555-1234");
    expect(input()).toHaveValue("(404) 555-1234");
    expect(screen.getByTestId("e164")).toHaveTextContent("+14045551234");
  });

  it("never auto-switches the country from what's typed or pasted", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(input());
    await user.paste("+442079460000");
    expect(countryButton()).toHaveAccessibleName(/United States \+1/);
  });

  it("backspacing over a formatting character still deletes a digit", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(input(), "404"); // renders "(404)" — caret sits after ")"
    expect(input()).toHaveValue("(404)");
    await user.type(input(), "{backspace}");
    expect(input()).toHaveValue("40");
  });

  it("backspacing a digit in the middle removes that digit, not the last one", async () => {
    const user = userEvent.setup();
    render(<Harness initial="+14045551234" />);
    // "(404) 555-1234" — caret after "(404) 5"; backspace must eat that "5".
    await user.type(input(), "{backspace}", {
      initialSelectionStart: 7,
      initialSelectionEnd: 7,
    });
    expect(screen.getByTestId("e164")).toHaveTextContent("+1404551234");
    expect(input().value.replace(/\D/g, "")).toBe("404551234");
  });

  it("keeps the caret at the edit point instead of jumping to the end", async () => {
    const user = userEvent.setup();
    render(<Harness initial="+14045551234" />);
    // Backspace the "5" right before the caret at "(404) 5|55-1234".
    await user.type(input(), "{backspace}", {
      initialSelectionStart: 7,
      initialSelectionEnd: 7,
    });
    // The caret stays after the 3rd digit — not at the end of the field.
    const el = input();
    const digitsBeforeCaret = el.value
      .slice(0, el.selectionStart ?? 0)
      .replace(/\D/g, "").length;
    expect(digitsBeforeCaret).toBe(3);
    expect(el.selectionStart).not.toBe(el.value.length);
  });

  it("deleting a formatting character in the middle eats the digit before it, not the tail", async () => {
    const user = userEvent.setup();
    render(<Harness initial="+14045551234" />);
    // Caret after "(404) " — backspace lands on the space: the "4" before it
    // must go; the trailing "…1234" must survive untouched.
    await user.type(input(), "{backspace}", {
      initialSelectionStart: 6,
      initialSelectionEnd: 6,
    });
    expect(screen.getByTestId("e164")).toHaveTextContent("+1405551234");
  });

  it("shows an existing foreign value under its own flag, without the +code in the field", () => {
    render(<Harness initial="+380958601427" />);
    expect(input().value).not.toContain("+");
    expect(input().value.replace(/\D/g, "")).toBe("958601427");
    expect(countryButton()).toHaveAccessibleName(/Ukraine \+380/);
  });

  it("lockCountry shows the code but offers no way to change it", () => {
    render(<PhoneInput value="+14045551234" onChange={() => {}} lockCountry />);
    // The number still edits, but the country is a static display — no button.
    expect(screen.queryByRole("button", { name: /Country code/ })).not.toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByPlaceholderText<HTMLInputElement>("Phone number")).not.toBeDisabled();
  });
});
