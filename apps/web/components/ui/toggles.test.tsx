import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";
import { Switch } from "./switch";

const cls = (el: HTMLElement) => el.className.split(/\s+/);

describe("a checkbox", () => {
  it("is the browser's own 13px box, ticked in Workiz's link blue", () => {
    // clients_fields / list_02: 13×13, 1px #767676, 2px corner; ticked #6aa8ee.
    render(<Checkbox aria-label="Name" />);
    const box = screen.getByRole("checkbox", { name: "Name" });
    expect(cls(box)).toEqual(
      expect.arrayContaining(["size-[13px]", "rounded-[2px]", "border-wz-native-check", "data-[state=checked]:bg-wz-link"]),
    );
    expect(cls(box)).not.toContain("data-[state=checked]:bg-brand");
  });
});

describe("a switch", () => {
  it("is Workiz's green 40×20 toggle with a 16px knob", () => {
    // toggleSwitch-module small: #50d58c on, #bbbbbb off.
    render(<Switch aria-label="Taxable" />);
    const sw = screen.getByRole("switch", { name: "Taxable" });
    expect(cls(sw)).toEqual(
      expect.arrayContaining(["h-5", "w-10", "data-[state=checked]:bg-wz-switch-on", "data-[state=unchecked]:bg-wz-switch-off"]),
    );
    const knob = sw.querySelector("[data-slot=switch-thumb]") as HTMLElement;
    expect(cls(knob)).toEqual(expect.arrayContaining(["size-4", "data-[state=checked]:translate-x-[22px]"]));
  });
});
