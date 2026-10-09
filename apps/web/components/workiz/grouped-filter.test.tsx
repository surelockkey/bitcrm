import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzGroupedFilter, wzFilterChips, type WzFilterGroup, type WzFilterValue } from "./grouped-filter";

/*
 * Workiz's "Filter results" on its reports (rep_jobs_wz_05_filter_open,
 * _05b_filter_typed, _17d_filter_two_chips, _20_all_groups_chips): a
 * react-select whose groups stand side by side in the menu; picks become
 * "status: Done" chips in the box.
 */
const GROUPS: WzFilterGroup[] = [
  {
    key: "status",
    label: "Status",
    chip: "status",
    options: [
      { value: "submitted", label: "Submitted" },
      { value: "done", label: "Done" },
      { value: "done:paid", label: "Done - Paid" },
    ],
  },
  {
    key: "techId",
    label: "Team",
    chip: "user",
    options: [
      { value: "u1", label: "Sam Tech" },
      { value: "u2", label: "Done Right Locks" },
    ],
  },
  { key: "tagId", label: "Tags", chip: "tag", options: [{ value: "t1", label: "VIP", className: "bg-red-tag" }] },
  { key: "jobTypeId", label: "Job type", chip: "type", options: [{ value: "jt1", label: "Lockout" }] },
];

function Harness({ initial = {}, onChange, chipOrder }: { initial?: WzFilterValue; onChange?: (v: WzFilterValue) => void; chipOrder?: string[] }) {
  const [value, setValue] = useState<WzFilterValue>(initial);
  return (
    <WzGroupedFilter
      groups={GROUPS}
      value={value}
      chipOrder={chipOrder}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const input = () => screen.getByRole("combobox", { name: "Filter results" });
const groupNames = () =>
  within(screen.getByRole("listbox"))
    .getAllByRole("group")
    .map((g) => g.getAttribute("aria-label"));
const optionsOf = (group: string) =>
  within(within(screen.getByRole("listbox")).getByRole("group", { name: group }))
    .getAllByRole("option")
    .map((o) => o.textContent);

describe("wzFilterChips", () => {
  it("prints each pick as Workiz does — its filter key, a colon, the name", () => {
    expect(wzFilterChips(GROUPS, { status: ["done"], jobTypeId: ["jt1"] }).map((c) => c.label)).toEqual([
      "status: Done",
      "type: Lockout",
    ]);
  });

  it("lists the chips in the order asked for, picks inside a group in the order made", () => {
    const chips = wzFilterChips(GROUPS, { status: ["done"], techId: ["u2", "u1"], jobTypeId: ["jt1"] }, ["techId", "jobTypeId", "status"]);
    expect(chips.map((c) => c.label)).toEqual(["user: Done Right Locks", "user: Sam Tech", "type: Lockout", "status: Done"]);
  });

  it("names a value it cannot find by the value itself", () => {
    expect(wzFilterChips(GROUPS, { status: ["gone"] })[0].label).toBe("status: gone");
  });
});

describe("WzGroupedFilter", () => {
  it("is an empty 'Select...' box until opened", () => {
    render(<Harness />);
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Select...")).toBeInTheDocument();
  });

  it("opens with every group side by side, in the order given", async () => {
    render(<Harness />);
    await userEvent.click(input());
    expect(input()).toHaveAttribute("aria-expanded", "true");
    expect(groupNames()).toEqual(["Status", "Team", "Tags", "Job type"]);
    expect(optionsOf("Status")).toEqual(["Submitted", "Done", "Done - Paid"]);
  });

  it("narrows every group by what is typed in the box, and drops the groups with no match", async () => {
    render(<Harness />);
    await userEvent.click(input());
    await userEvent.type(input(), "done");
    expect(groupNames()).toEqual(["Status", "Team"]);
    expect(optionsOf("Status")).toEqual(["Done", "Done - Paid"]);
    expect(optionsOf("Team")).toEqual(["Done Right Locks"]);
  });

  it("says so when nothing matches", async () => {
    render(<Harness />);
    await userEvent.click(input());
    await userEvent.type(input(), "zzz");
    expect(within(screen.getByRole("listbox")).getByText("No options")).toBeInTheDocument();
  });

  it("adds a pick as a chip, closes, and keeps it out of the list", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(input());
    await userEvent.click(screen.getByRole("option", { name: "Done" }));
    expect(onChange).toHaveBeenLastCalledWith({ status: ["done"] });
    expect(input()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("status: Done")).toBeInTheDocument();
    expect(screen.queryByText("Select...")).toBeNull();
    await userEvent.click(input());
    expect(optionsOf("Status")).toEqual(["Submitted", "Done - Paid"]);
  });

  it("picks the focused option with the keyboard, walking group after group", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    input().focus();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith({ techId: ["u1"] });
  });

  it("removes one chip with its ×, the last with Backspace, all with the clear ×", async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ status: ["done"], jobTypeId: ["jt1"], techId: ["u1"] }} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove status: Done" }));
    expect(onChange).toHaveBeenLastCalledWith({ jobTypeId: ["jt1"], techId: ["u1"] });
    input().focus();
    await userEvent.keyboard("{Backspace}");
    // The last chip in the box goes: groups in the order given, so Job type.
    expect(onChange).toHaveBeenLastCalledWith({ techId: ["u1"] });
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("draws a coloured option (a tag) as its chip in the list", async () => {
    render(<Harness />);
    await userEvent.click(input());
    const vip = screen.getByRole("option", { name: "VIP" });
    expect(within(vip).getByText("VIP")).toHaveClass("bg-red-tag");
  });
});

/*
 * The Payments report's "Filter results" (rep_payments_wz_17c_chip_tech):
 * a payment type's chip is the bare name ("Cash"); a service area is listed
 * as a chip in its own colour, and the chip a pick leaves keeps that colour
 * ("metro: SURE LOCK CT", white on #7fffd4, the × on the colour too).
 */
describe("WzGroupedFilter — key-less and coloured chips (Payments report)", () => {
  const PAY: WzFilterGroup[] = [
    { key: "types", label: "Payment type", chip: "", options: [{ value: "cash", label: "Cash" }] },
    {
      key: "areas",
      label: "Service Areas",
      chip: "metro",
      chipColored: true,
      options: [
        { value: "a1", label: "SURE LOCK CT", color: "#7fffd4" },
        { value: "a2", label: "North Carolina" },
      ],
    },
  ];

  it("prints a chip without a key as the bare name", () => {
    expect(wzFilterChips(PAY, { types: ["cash"], areas: ["a1"] }).map((c) => c.label)).toEqual(["Cash", "metro: SURE LOCK CT"]);
  });

  it("lists an option with a colour as a chip of that colour", async () => {
    render(<WzGroupedFilter groups={PAY} value={{}} onChange={() => {}} />);
    await userEvent.click(input());
    expect(within(screen.getByRole("option", { name: "SURE LOCK CT" })).getByText("SURE LOCK CT")).toHaveStyle({
      backgroundColor: "#7fffd4",
    });
    // No colour: plain words.
    expect(within(screen.getByRole("option", { name: "North Carolina" })).queryByText("North Carolina", { selector: "span" })).toBeNull();
  });

  it("keeps the colour on the chip a pick leaves, only where the group asks for it", () => {
    render(<WzGroupedFilter groups={PAY} value={{ types: ["cash"], areas: ["a1", "a2"] }} onChange={() => {}} />);
    expect(screen.getByText("metro: SURE LOCK CT").closest("[data-chip-color]")).toHaveStyle({ backgroundColor: "#7fffd4" });
    expect(screen.getByText("metro: North Carolina").closest("[data-chip-color]")).toBeNull();
    expect(screen.getByText("Cash").closest("[data-chip-color]")).toBeNull();
  });
});

// The Items report's box (rep_items_wz_01_loaded / _05_filter_open): 48.64px
// tall (react-select's 3.04rem) where the Jobs report's is 38, and it keeps
// that height when the yellow ring replaces its edge.
describe("WzGroupedFilter size", () => {
  const control = () => document.querySelector('[data-slot="wz-grouped-filter-control"]')!;

  it("is the 38px box by default", () => {
    render(<WzGroupedFilter groups={GROUPS} value={{}} onChange={() => {}} />);
    expect(control()).toHaveClass("min-h-[38px]");
    expect(control()).not.toHaveClass("min-h-[48.64px]");
  });

  it("is 48.64px tall, focused too, when tall", () => {
    render(<WzGroupedFilter size="tall" groups={GROUPS} value={{}} onChange={() => {}} />);
    expect(control()).toHaveClass("min-h-[48.64px]", "group-data-[focused=true]/wzgf:min-h-[48.64px]");
    expect(control()).not.toHaveClass("min-h-[38px]");
    expect(control()).not.toHaveClass("group-data-[focused=true]/wzgf:min-h-9");
  });
});
