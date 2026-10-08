import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { WzTextarea } from "./textarea";

describe("WzTextarea", () => {
  it("shows its placeholder inside and is named by it", () => {
    render(<WzTextarea placeholder="Manager Note" />);
    const box = screen.getByRole("textbox", { name: "Manager Note" });
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveAttribute("placeholder", "Manager Note");
  });

  it("prefers an explicit accessible name", () => {
    render(<WzTextarea placeholder="Manager Note" aria-label="Dispatcher note" />);
    expect(screen.getByRole("textbox", { name: "Dispatcher note" })).toBeInTheDocument();
  });

  it("is 100px tall unless told otherwise, like Workiz's custom-field notes", () => {
    const { rerender } = render(<WzTextarea placeholder="Manager Note" />);
    expect(screen.getByRole("textbox").className).toContain("h-[100px]");
    rerender(<WzTextarea placeholder="Manager Note" className="h-[75px]" />);
    expect(screen.getByRole("textbox").className).toContain("h-[75px]");
    expect(screen.getByRole("textbox").className).not.toContain("h-[100px]");
  });

  it("is a drop-in for react-hook-form's register", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const form = useForm<{ note: string }>({ defaultValues: { note: "call first" } });
      return (
        <form onSubmit={form.handleSubmit((v) => onSubmit(v))}>
          <WzTextarea placeholder="Manager Note" {...form.register("note")} />
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    const box = screen.getByRole("textbox", { name: "Manager Note" }) as HTMLTextAreaElement;
    expect(box.value).toBe("call first");
    await userEvent.type(box, ", gate code 12");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ note: "call first, gate code 12" });
  });

  it("can be disabled", () => {
    render(<WzTextarea placeholder="Manager Note" disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("ties an error message to the box", () => {
    render(<WzTextarea placeholder="Manager Note" error="Required field" />);
    const box = screen.getByRole("textbox");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toHaveAttribute("aria-describedby", screen.getByText("Required field").id);
  });
});
