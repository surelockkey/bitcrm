import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { WzFilterSelect, filterSelectGroups, type WzFilterGroup, type WzFilterPick } from "./filter-select";

const GROUPS: WzFilterGroup[] = [
  {
    id: "tag",
    title: "Tags",
    chipPrefix: "tag",
    options: [
      { value: "t1", label: "Tech Line", colorClassName: "tone-red" },
      { value: "t2", label: "tax free", colorClassName: "tone-blue" },
      { value: "t3", label: "PLATINUM", colorClassName: "tone-blue" },
    ],
  },
  { id: "plan", title: "Has service plan", options: [{ value: "1", label: "Yes" }, { value: "0", label: "No" }] },
];

describe("filterSelectGroups — what the open menu lists", () => {
  it("leaves out what is picked and closes up empty groups", () => {
    const out = filterSelectGroups(GROUPS, [{ group: "plan", value: "1" }, { group: "plan", value: "0" }], "");
    expect(out.map((g) => g.id)).toEqual(["tag"]);
  });

  it("narrows by typed text, case-insensitive, anywhere in the label", () => {
    const out = filterSelectGroups(GROUPS, [], "TAX");
    expect(out).toHaveLength(1);
    expect(out[0].options.map((o) => o.label)).toEqual(["tax free"]);
  });
});

function Harness({ onChange }: { onChange?: (v: WzFilterPick[]) => void }) {
  const [value, setValue] = useState<WzFilterPick[]>([]);
  return (
    <WzFilterSelect
      groups={GROUPS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe("WzFilterSelect — Workiz's Filter results", () => {
  it("is a combobox that reads 'Filter results' until something is picked", () => {
    render(<Harness />);
    expect(screen.getByRole("combobox", { name: "Filter results" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Filter results")).toBeInTheDocument();
  });

  it("opens the groups side by side, headed in capitals", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox", { name: "Filter results" }));
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true");
    const tags = screen.getByRole("listbox", { name: "Tags" });
    expect(within(tags).getAllByRole("option").map((o) => o.textContent)).toEqual(["Tech Line", "tax free", "PLATINUM"]);
    expect(screen.getByRole("listbox", { name: "Has service plan" })).toBeInTheDocument();
  });

  it("a pick becomes a 'tag: PLATINUM' chip and the menu closes", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Filter results" }));
    await userEvent.click(screen.getByRole("option", { name: "PLATINUM" }));
    expect(onChange).toHaveBeenLastCalledWith([{ group: "tag", value: "t3" }]);
    expect(screen.getByText("tag: PLATINUM")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it("a chip's × takes it off; the clear-all × takes them all", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole("combobox", { name: "Filter results" });
    await userEvent.click(box);
    await userEvent.click(screen.getByRole("option", { name: "PLATINUM" }));
    await userEvent.click(box);
    await userEvent.click(screen.getByRole("option", { name: "tax free" }));
    expect(onChange).toHaveBeenLastCalledWith([
      { group: "tag", value: "t3" },
      { group: "tag", value: "t2" },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Remove tag: PLATINUM" }));
    expect(onChange).toHaveBeenLastCalledWith([{ group: "tag", value: "t2" }]);
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("types to narrow, picks with Enter, and Backspace on an empty box drops the last chip", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const box = screen.getByRole("combobox", { name: "Filter results" });
    await userEvent.type(box, "tech");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Tech Line"]);
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith([{ group: "tag", value: "t1" }]);
    await userEvent.keyboard("{Backspace}");
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

/**
 * Workiz's Team filter (pg_technicians_wz_04_filter_open): the status column
 * has no heading, and its pick is a white chip with #333 words
 * ("status: Active", react-select's multi-value as Workiz styles it).
 */
describe("WzFilterSelect — an untitled group with white chips", () => {
  const TEAM: WzFilterGroup[] = [
    {
      id: "status",
      title: "",
      chipPrefix: "status",
      chipTone: "white",
      options: [
        { value: "active", label: "Active" },
        { value: "inactive", label: "Disabled" },
      ],
    },
    { id: "role", title: "Role", chipPrefix: "role", options: [{ value: "r1", label: "tech" }] },
  ];

  it("draws no heading over a group without a title, and names it by its chips' word", async () => {
    render(<WzFilterSelect groups={TEAM} value={[]} onChange={() => {}} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Filter results" }));
    const status = screen.getByRole("listbox", { name: "status" });
    expect(within(status).queryByRole("heading")).toBeNull();
    expect(within(screen.getByRole("listbox", { name: "Role" })).getByRole("heading", { name: "Role" })).toBeInTheDocument();
  });

  it("prints a white-toned group's pick as a white chip", () => {
    render(<WzFilterSelect groups={TEAM} value={[{ group: "status", value: "active" }]} onChange={() => {}} />);
    // Regular words: 400, where a coloured chip's are 500 (uikit_wz_pricebook vs pg_contacts_wz_12).
    expect(screen.getByText("status: Active").className).toContain("font-normal");
    const chip = screen.getByText("status: Active").parentElement!;
    expect(chip.className).toContain("bg-background");
    expect(chip.className).toContain("text-wz-value");
    expect(chip.className).not.toContain("bg-wz-disabled-border");
  });
});
