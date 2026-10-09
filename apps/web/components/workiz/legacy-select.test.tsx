import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzLegacySelect } from "./legacy-select";

const AREAS = [
  { value: "", label: "All Service Areas" },
  { value: "a1", label: "Platinum_AL" },
  { value: "a2", label: "SURE LOCK CT" },
  { value: "a3", label: "SURE LOCK RI" },
];

describe("WzLegacySelect", () => {
  it("shows the chosen option on a combobox named by its label", () => {
    render(
      <WzLegacySelect
        aria-label="Service area"
        options={AREAS}
        value="a2"
        onChange={() => {}}
      />,
    );
    const box = screen.getByRole("combobox", { name: "Service area" });
    expect(box).toHaveTextContent("SURE LOCK CT");
    expect(box).toHaveAttribute("aria-expanded", "false");
  });

  it("opens its list with the chosen option marked, and picks on a click", async () => {
    const onChange = vi.fn();
    render(
      <WzLegacySelect
        aria-label="Service area"
        options={AREAS}
        value=""
        onChange={onChange}
      />,
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: "Service area" }),
    );
    const list = screen.getByRole("listbox", { name: "Service area" });
    expect(
      screen.getByRole("option", { name: "All Service Areas" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(list.children).toHaveLength(4);
    await userEvent.click(screen.getByRole("option", { name: "SURE LOCK RI" }));
    expect(onChange).toHaveBeenCalledWith("a3");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("narrows a searchable list as you type, and picks with the keyboard", async () => {
    const onChange = vi.fn();
    render(
      <WzLegacySelect
        aria-label="Service area"
        options={AREAS}
        value=""
        onChange={onChange}
        searchable
      />,
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: "Service area" }),
    );
    const search = screen.getByRole("searchbox", { name: "Search" });
    expect(search).toHaveFocus();
    await userEvent.type(search, "sure");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "SURE LOCK CT",
      "SURE LOCK RI",
    ]);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("a3");
  });

  it("closes on Escape without choosing", async () => {
    const onChange = vi.fn();
    render(
      <WzLegacySelect
        aria-label="Source type"
        options={AREAS}
        value=""
        onChange={onChange}
      />,
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: "Source type" }),
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled: stays shut and picks nothing (Workiz's External Company while an Ad Group is chosen)", async () => {
    const onChange = vi.fn();
    render(
      <WzLegacySelect
        aria-label="External company"
        options={AREAS}
        value=""
        onChange={onChange}
        disabled
      />,
    );
    const box = screen.getByRole("combobox", { name: "External company" });
    expect(box).toBeDisabled();
    await userEvent.click(box);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("compact: the Finance Reporting box — 26px, the chosen row #ededed (rep_commission_wz_06_*)", async () => {
    render(
      <WzLegacySelect
        aria-label="Report mode"
        size="compact"
        options={AREAS}
        value="a1"
        onChange={() => {}}
      />,
    );
    const box = screen.getByRole("combobox", { name: "Report mode" });
    expect(box.className).toContain("h-[26px]");
    await userEvent.click(box);
    const chosen = screen.getByRole("option", { name: "Platinum_AL" });
    expect(chosen).toHaveAttribute("aria-selected", "true");
    expect(chosen.className).toContain("bg-[#ededed]");
    expect(chosen.className).not.toContain("bg-black/75");
  });
});
