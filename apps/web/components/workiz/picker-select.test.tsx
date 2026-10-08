import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzPickerSelect } from "./picker-select";

/*
 * The "By: Job end date ⌄" row under the Jobs report's date box
 * (rep_jobs_wz_01_default, _07_by_open): Workiz's `_picker` select — the
 * prefix and the choice in one 36px row, its list of 37px rows hung under it.
 */
const OPTIONS = [
  { value: "created", label: "Job created" },
  { value: "scheduled", label: "Job date" },
  { value: "end", label: "Job end date" },
];

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("end");
  return (
    <WzPickerSelect
      prefix="By"
      options={OPTIONS}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

const box = () => screen.getByRole("button", { name: /^By:/ });

describe("WzPickerSelect", () => {
  it("prints the prefix and the choice in one row", () => {
    render(<Harness />);
    expect(box()).toHaveTextContent("By: Job end date");
    expect(box()).toHaveAttribute("aria-expanded", "false");
  });

  it("hangs every choice under it on a click, and takes the one picked", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(box());
    const list = screen.getByRole("listbox", { name: "By" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Job created", "Job date", "Job end date"]);
    expect(within(list).getByRole("option", { name: "Job end date" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(within(list).getByRole("option", { name: "Job created" }));
    expect(onChange).toHaveBeenLastCalledWith("created");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box()).toHaveTextContent("By: Job created");
  });

  it("closes on a second click, on Escape and on a click away", async () => {
    render(
      <div>
        <Harness />
        <p>away</p>
      </div>,
    );
    await userEvent.click(box());
    await userEvent.click(box());
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.click(box());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.click(box());
    await userEvent.click(screen.getByText("away"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("picks with the keyboard", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(box());
    const option = screen.getByRole("option", { name: "Job date" });
    option.focus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("scheduled");
  });
});
