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
