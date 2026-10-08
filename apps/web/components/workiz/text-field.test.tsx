import { useEffect, useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, type UseFormReturn } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { WzTextField } from "./text-field";

/**
 * The Workiz text field (`sajInput` + `_fLabel`): the label sits inside the
 * box like a placeholder and floats to the top-left when the field is
 * focused, hovered or has a value. The float is pure CSS — `:focus`,
 * `:hover` and `:not(:placeholder-shown)` on the input — so it follows the
 * value however it got there (typing, a controlled prop, react-hook-form's
 * defaultValues / setValue / reset, browser autofill) without a re-render.
 */
const floated = (input: HTMLElement) =>
  input.matches(":focus") || !input.matches(":placeholder-shown");

describe("WzTextField", () => {
  it("labels the input with a real <label>", () => {
    render(<WzTextField label="Client name" />);
    const input = screen.getByLabelText("Client name");
    expect(input.tagName).toBe("INPUT");
    const label = screen.getByText("Client name");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", input.id);
  });

  it("keeps an id it is given", () => {
    render(<WzTextField label="Email" id="client-email" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("id", "client-email");
  });

  it("rests inside the box while empty, and floats once typed into", async () => {
    render(<WzTextField label="Company name" />);
    const input = screen.getByLabelText("Company name");
    expect(floated(input)).toBe(false);
    await userEvent.type(input, "Acme");
    expect(floated(input)).toBe(true);
    input.blur();
    // Still floated after blur: the value holds it up.
    expect(floated(input)).toBe(true);
    await userEvent.clear(input);
    input.blur();
    expect(floated(input)).toBe(false);
  });

  it("floats while focused even when empty", () => {
    render(<WzTextField label="Job name" />);
    const input = screen.getByLabelText("Job name");
    act(() => input.focus());
    expect(floated(input)).toBe(true);
  });

  it("styles the label off the input's own state, for focus, hover and a value", () => {
    render(<WzTextField label="Zip" />);
    const label = screen.getByText("Zip");
    const input = screen.getByLabelText("Zip");
    // The label follows the input in the DOM so the peer selectors can reach it.
    expect(input.nextElementSibling).toBe(label);
    expect(input.className).toContain("peer");
    for (const trigger of ["peer-focus:", "peer-[:hover:enabled]:", "peer-[:not(:placeholder-shown)]:"]) {
      expect(label.className, trigger).toContain(`${trigger}top-[2px]`);
      expect(label.className, trigger).toContain(`${trigger}text-[12px]`);
    }
  });

  it("works controlled", async () => {
    const seen: string[] = [];
    function Controlled() {
      const [v, setV] = useState("Dustin");
      return (
        <WzTextField
          label="First Name"
          value={v}
          onChange={(e) => {
            seen.push(e.target.value);
            setV(e.target.value);
          }}
        />
      );
    }
    render(<Controlled />);
    const input = screen.getByLabelText("First Name") as HTMLInputElement;
    expect(input.value).toBe("Dustin");
    expect(floated(input)).toBe(true);
    await userEvent.type(input, "!");
    expect(input.value).toBe("Dustin!");
    expect(seen.at(-1)).toBe("Dustin!");
  });

  it("works uncontrolled with a defaultValue", () => {
    render(<WzTextField label="Unit" defaultValue="4B" />);
    const input = screen.getByLabelText("Unit") as HTMLInputElement;
    expect(input.value).toBe("4B");
    expect(floated(input)).toBe(true);
  });

  it("is a drop-in for react-hook-form's register, including setValue and reset", async () => {
    const onSubmit = vi.fn();
    const seen: { api?: UseFormReturn<{ po: string }> } = {};
    function Form() {
      const form = useForm<{ po: string }>({ defaultValues: { po: "C-77" } });
      useEffect(() => {
        seen.api = form;
      });
      return (
        <form onSubmit={form.handleSubmit((v) => onSubmit(v))}>
          <WzTextField label="C PO" {...form.register("po")} />
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    const input = screen.getByLabelText("C PO") as HTMLInputElement;
    expect(input).toHaveAttribute("name", "po");
    expect(input.value).toBe("C-77");
    expect(floated(input)).toBe(true);

    await userEvent.clear(input);
    await userEvent.type(input, "VPO-1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ po: "VPO-1" });

    // Values written behind the field's back still move the label.
    act(() => seen.api!.setValue("po", ""));
    expect(input.value).toBe("");
    expect(floated(input)).toBe(false);
    act(() => seen.api!.reset({ po: "WO-9" }));
    expect(input.value).toBe("WO-9");
    expect(floated(input)).toBe(true);
  });

  it("reports blur to react-hook-form (touched state)", async () => {
    const seen = { touched: false };
    function Form() {
      const form = useForm<{ email: string }>({ defaultValues: { email: "" } });
      const touched = !!form.formState.touchedFields.email;
      useEffect(() => {
        seen.touched = touched;
      });
      return <WzTextField label="Email" {...form.register("email")} />;
    }
    render(<Form />);
    const input = screen.getByLabelText("Email");
    await userEvent.click(input);
    await userEvent.tab();
    expect(seen.touched).toBe(true);
  });

  it("can be disabled", () => {
    render(<WzTextField label="Phone" defaultValue="(469) 396-8179" disabled />);
    const input = screen.getByLabelText("Phone");
    expect(input).toBeDisabled();
    expect(input.closest("[data-slot=wz-text-field]")).toHaveAttribute("data-disabled", "true");
  });

  it("shows a validation message and ties it to the input", () => {
    render(<WzTextField label="Client name" error="Required field" />);
    const input = screen.getByLabelText("Client name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const msg = screen.getByText("Required field");
    expect(input).toHaveAttribute("aria-describedby", msg.id);
  });

  it("is not invalid without an error", () => {
    render(<WzTextField label="Client name" />);
    expect(screen.getByLabelText("Client name")).not.toHaveAttribute("aria-invalid");
  });

  it("renders adornments on the right and keeps the text clear of them", () => {
    render(
      <WzTextField
        label="Phone"
        defaultValue="(469) 396-8179"
        endAdornment={<button type="button">Call</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Call" })).toBeInTheDocument();
    const input = screen.getByLabelText("Phone");
    expect(input.className).toMatch(/pr-\[/);
  });

  it("overhangs its column by 2px like Workiz's content-box inputs, unless told not to", () => {
    const { rerender } = render(<WzTextField label="Client name" />);
    expect(screen.getByLabelText("Client name").className).toContain("w-[calc(100%+2px)]");
    rerender(<WzTextField label="Client name" overhang={false} />);
    expect(screen.getByLabelText("Client name").className).not.toContain("w-[calc(100%+2px)]");
  });

  it("is as tall as a select (3.04rem) so rows step down alike", () => {
    render(<WzTextField label="Zip" />);
    const wrap = screen.getByLabelText("Zip").closest("[data-slot=wz-text-field]")!;
    expect(wrap.className).toContain("min-h-[3.04rem]");
    // Not a flex-grow item by default: in a column it must not stretch.
    expect(wrap.className).not.toMatch(/(^|\s)flex-1(\s|$)/);
  });

  it("forwards a ref to the input", () => {
    let node: HTMLInputElement | null = null;
    render(<WzTextField label="Vendor N" ref={(n) => { node = n; }} />);
    expect(node).toBe(screen.getByLabelText("Vendor N"));
  });
});
