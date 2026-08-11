import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_VISIBLE, JOB_FIELDS } from "../fields";
import { useJobFieldsStore } from "../fields-store";
import { FieldsMenu } from "./fields-menu";

beforeEach(() => {
  localStorage.clear();
  useJobFieldsStore.setState({ visible: { ...DEFAULT_VISIBLE } });
});

async function openMenu() {
  const u = userEvent.setup();
  render(<FieldsMenu />);
  await u.click(screen.getByRole("button", { name: /fields/i }));
  return u;
}

describe("FieldsMenu", () => {
  it("renders a Fields button", () => {
    render(<FieldsMenu />);
    expect(screen.getByRole("button", { name: /fields/i })).toBeInTheDocument();
  });

  it("opens a menu with a checkbox per hideable field, all checked by default", async () => {
    await openMenu();
    const items = screen.getAllByRole("menuitemcheckbox");
    expect(items.map((i) => i.textContent)).toEqual(JOB_FIELDS.map((f) => f.label));
    for (const item of items) expect(item).toHaveAttribute("aria-checked", "true");
  });

  it("unchecking a field hides it in the store; the menu stays open", async () => {
    const u = await openMenu();
    await u.click(screen.getByRole("menuitemcheckbox", { name: "Tags" }));
    expect(useJobFieldsStore.getState().visible.tags).toBe(false);
    // Still open so several fields can be toggled in one go.
    expect(screen.getByRole("menuitemcheckbox", { name: "Tags" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("reflects fields already hidden in the store", async () => {
    useJobFieldsStore.setState({
      visible: { ...DEFAULT_VISIBLE, scheduled: false },
    });
    await openMenu();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Scheduled" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("menuitemcheckbox", { name: "Client" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("does not offer the job number", async () => {
    await openMenu();
    expect(screen.queryByRole("menuitemcheckbox", { name: /job\s?#/i })).toBeNull();
  });
});
