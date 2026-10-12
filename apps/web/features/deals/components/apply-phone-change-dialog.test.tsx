import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApplyPhoneChangeDialog } from "./apply-phone-change-dialog";

/**
 * "Apply these changes to…" — asked on Save when the job's first number was
 * changed (owner's design, 2026-10-12): this job only, this job and the
 * client profile (the default), or the profile and the client's open jobs.
 */
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

function renderDialog(over: Partial<Parameters<typeof ApplyPhoneChangeDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<ApplyPhoneChangeDialog open jobNumber="LSBE12" onConfirm={onConfirm} onCancel={onCancel} {...over} />);
  return { onConfirm, onCancel };
}

describe("ApplyPhoneChangeDialog", () => {
  it("says what changed and offers the three places, in the owner's words", () => {
    renderDialog();

    expect(screen.getByRole("dialog", { name: "Apply these changes to…" })).toBeInTheDocument();
    expect(screen.getByText("You changed this client's phone number.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^This job only/ })).toBeInTheDocument();
    expect(screen.getByText("Job #LSBE12. The client profile keeps its current details.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^This job and the client profile/ })).toBeInTheDocument();
    expect(screen.getByText("Future jobs use the new details. Existing jobs are untouched.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^This job, the profile, and open jobs/ })).toBeInTheDocument();
    expect(screen.getByText("Open and unpaid jobs only. Paid and closed jobs never change.")).toBeInTheDocument();
  });

  it("starts on 'This job and the client profile'", async () => {
    const { onConfirm } = renderDialog();

    expect(screen.getByRole("radio", { name: /^This job and the client profile/ })).toBeChecked();
    await user().click(screen.getByRole("button", { name: "Save changes" }));
    expect(onConfirm).toHaveBeenCalledWith("client");
  });

  it("answers the place picked", async () => {
    const u = user();
    const { onConfirm } = renderDialog();

    await u.click(screen.getByRole("radio", { name: /^This job only/ }));
    await u.click(screen.getByRole("button", { name: "Save changes" }));
    await u.click(screen.getByText("This job, the profile, and open jobs"));
    await u.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onConfirm.mock.calls).toEqual([["job"], ["open_jobs"]]);
  });

  it("Cancel and the × save nothing", async () => {
    const u = user();
    const { onConfirm, onCancel } = renderDialog();

    await u.click(screen.getByRole("button", { name: "Cancel" }));
    await u.click(screen.getByRole("button", { name: "Close" }));

    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the picked card carries the blue edge and the grey fill of the design", () => {
    renderDialog();
    const picked = screen.getByRole("radio", { name: /^This job and the client profile/ }).closest("label")!;
    const other = screen.getByRole("radio", { name: /^This job only/ }).closest("label")!;

    expect(picked.className).toMatch(/border-wz-link/);
    expect(picked.className).toMatch(/bg-wz-secondary-hover/);
    expect(other.className).toMatch(/border-wz-frame/);
  });
});
