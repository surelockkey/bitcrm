import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WzFormModal } from "./form-modal";

describe("WzFormModal — Workiz's Add New / Edit modal", () => {
  it("titles itself, holds the fields, and ends with Cancel and Save", () => {
    render(
      <WzFormModal open onOpenChange={() => {}} title="Add New Job Type" onSave={() => {}}>
        <input aria-label="Job Type Name" />
      </WzFormModal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Add New Job Type" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Job Type Name" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("Cancel closes without saving; Save saves", async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn();
    render(
      <WzFormModal open onOpenChange={onOpenChange} title="Edit Job Type" onSave={onSave}>
        <span />
      </WzFormModal>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("Enter in a field saves, as a form does", async () => {
    const onSave = vi.fn();
    render(
      <WzFormModal open onOpenChange={() => {}} title="t" onSave={onSave}>
        <input aria-label="Name" />
      </WzFormModal>,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Rekey{Enter}");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("holds Save while it cannot or is saving, and shows a refusal", () => {
    const { rerender } = render(
      <WzFormModal open onOpenChange={() => {}} title="t" onSave={() => {}} saveDisabled error="Name is required">
        <span />
      </WzFormModal>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");

    rerender(
      <WzFormModal open onOpenChange={() => {}} title="t" onSave={() => {}} saving saveLabel="Create">
        <span />
      </WzFormModal>,
    );
    expect(screen.getByRole("button", { name: "Create" })).toHaveAttribute("aria-busy", "true");
  });

  it("can be a right-hand drawer, as Workiz's Add New Field is", () => {
    render(
      <WzFormModal open onOpenChange={() => {}} title="Add New Field" onSave={() => {}} variant="drawer">
        <span />
      </WzFormModal>,
    );
    expect(screen.getByRole("dialog", { name: "Add New Field" })).toHaveAttribute("data-slot", "wz-drawer");
  });

  it("read-only: no Save, Cancel reads Close, Enter saves nothing", async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <WzFormModal open onOpenChange={onOpenChange} title="SureLock" onSave={onSave} variant="full" readOnly>
        <input aria-label="Name" />
      </WzFormModal>,
    );
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "x{Enter}");
    expect(onSave).not.toHaveBeenCalled();
    // The footer's pill (the corner × is "Close" too).
    const close = screen.getAllByRole("button", { name: "Close" }).find((b) => b.dataset.slot === "wz-button");
    await userEvent.click(close!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("the whole-window form can put content beside the form (the Account page's logo column)", () => {
    render(
      <WzFormModal open onOpenChange={() => {}} title="t" onSave={() => {}} variant="full" aside={<p>Logo here</p>}>
        <span />
      </WzFormModal>,
    );
    expect(screen.getByText("Logo here")).toBeInTheDocument();
  });
});
