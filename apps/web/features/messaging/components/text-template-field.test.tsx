import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { TextTemplateField } from "./text-template-field";

function Harness({ initial = "", onValue = vi.fn() }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TextTemplateField
      label="On the Way"
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue(v);
      }}
      codes={["first_name", "tech_assigned"]}
      helper="Sent when the tech taps On my way."
    />
  );
}

/**
 * One of the Texting tab's "Text templates" (pg_settings_phone_wz_texting_scroll1):
 * the 14px/600 name, the box, the helper, the short-code chips that drop
 * `{{code}}` in where the caret was.
 */
describe("TextTemplateField", () => {
  it("names the box by its label and shows the helper and the chips", () => {
    render(<Harness initial="Hi" />);
    expect(screen.getByRole("textbox", { name: "On the Way" })).toHaveValue("Hi");
    expect(screen.getByText("Sent when the tech taps On my way.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Short codes for On the Way" })).toBeInTheDocument();
  });

  it("puts a chip's code in at the caret", async () => {
    const onValue = vi.fn();
    render(<Harness initial="Hi , here" onValue={onValue} />);
    const box = screen.getByRole("textbox", { name: "On the Way" }) as HTMLTextAreaElement;
    box.setSelectionRange(3, 3);
    fireEvent.select(box);
    await userEvent.click(screen.getByRole("button", { name: "First Name" }));
    expect(onValue).toHaveBeenLastCalledWith("Hi {{first_name}}, here");
  });

  it("adds at the end when the box was never clicked", async () => {
    const onValue = vi.fn();
    render(<Harness initial="Hi " onValue={onValue} />);
    await userEvent.click(screen.getByRole("button", { name: "Tech Assigned" }));
    expect(onValue).toHaveBeenLastCalledWith("Hi {{tech_assigned}}");
  });
});
