import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { WzButton, WzLink } from "./button";
import { WzCheckbox, WzSwitch } from "./toggles";

describe("WzSwitch", () => {
  it("is a switch with an accessible name", () => {
    render(<WzSwitch aria-label="Scheduled" defaultChecked />);
    const sw = screen.getByRole("switch", { name: "Scheduled" });
    expect(sw).toBeChecked();
  });

  it("toggles uncontrolled and reports it", async () => {
    const onChange = vi.fn();
    render(<WzSwitch aria-label="Scheduled" onCheckedChange={onChange} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toBeChecked();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("works controlled", async () => {
    function C() {
      const [on, setOn] = useState(true);
      return (
        <>
          <WzSwitch aria-label="Scheduled" checked={on} onCheckedChange={setOn} />
          <output>{on ? "on" : "off"}</output>
        </>
      );
    }
    render(<C />);
    await userEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("status")).toHaveTextContent("off");
  });

  it("drops into react-hook-form's register", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const form = useForm<{ scheduled: boolean }>({ defaultValues: { scheduled: true } });
      return (
        <form onSubmit={form.handleSubmit((v) => onSubmit(v))}>
          <WzSwitch aria-label="Scheduled" {...form.register("scheduled")} />
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    expect(screen.getByRole("switch")).toBeChecked();
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ scheduled: false });
  });

  it("cannot be flipped while disabled", async () => {
    render(<WzSwitch aria-label="Scheduled" defaultChecked disabled />);
    await userEvent.click(screen.getByRole("switch"));
    expect(screen.getByRole("switch")).toBeChecked();
  });
});

describe("WzCheckbox", () => {
  it("is a native checkbox named by its words", async () => {
    const onChange = vi.fn();
    render(<WzCheckbox label="All-day event" onCheckedChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "All-day event" });
    expect(box).toHaveAttribute("type", "checkbox");
    // Clicking the words ticks it, as a <label> should.
    await userEvent.click(screen.getByText("All-day event"));
    expect(box).toBeChecked();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("drops into react-hook-form's register", async () => {
    const onSubmit = vi.fn();
    function Form() {
      const form = useForm<{ allDay: boolean }>({ defaultValues: { allDay: false } });
      return (
        <form onSubmit={form.handleSubmit((v) => onSubmit(v))}>
          <WzCheckbox label="All-day event" {...form.register("allDay")} />
          <button type="submit">Save</button>
        </form>
      );
    }
    render(<Form />);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ allDay: true });
  });

  it("can be disabled", () => {
    render(<WzCheckbox label="All-day event" disabled />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});

describe("WzButton", () => {
  it("is a real button, type=button unless told otherwise", () => {
    render(<WzButton>Create</WzButton>);
    expect(screen.getByRole("button", { name: "Create" })).toHaveAttribute("type", "button");
  });

  it("uses the pill token, never a padded rounded-full", () => {
    render(
      <>
        <WzButton>Create</WzButton>
        <WzButton variant="secondary">View schedule</WzButton>
      </>,
    );
    for (const name of ["Create", "View schedule"]) {
      const cls = screen.getByRole("button", { name }).className;
      expect(cls).toContain("rounded-pill");
      expect(cls).not.toContain("rounded-full");
    }
  });

  it("keeps its size while busy and says so", () => {
    render(<WzButton loading>Save</WzButton>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
  });

  it("renders the icon before the words", () => {
    render(<WzButton variant="secondary" icon={<svg data-testid="cal" />}>View schedule</WzButton>);
    const button = screen.getByRole("button", { name: "View schedule" });
    expect(button.firstElementChild?.querySelector("[data-testid=cal]")).not.toBeNull();
  });
});

describe("WzLink", () => {
  it("is a button that looks like a link unless given an href", async () => {
    const onClick = vi.fn();
    render(<WzLink onClick={onClick}>Set recurring schedule</WzLink>);
    await userEvent.click(screen.getByRole("button", { name: "Set recurring schedule" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("is an anchor with an href", () => {
    render(<WzLink href="/schedule">View schedule</WzLink>);
    expect(screen.getByRole("link", { name: "View schedule" })).toHaveAttribute("href", "/schedule");
  });
});
