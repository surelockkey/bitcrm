import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { WzMapPin, WzMapPinCard, wzPinInitials, wzPinInk, WZ_UNASSIGNED_PIN } from "./map-pin";

describe("wzPinInitials", () => {
  // Read off pg_dispatch_wz_02_loaded: the tooltip name beside the pin's letters.
  it("takes the first character of the first and of the last word, as Workiz does", () => {
    expect(wzPinInitials("(2) CT - Tyler Boucher")).toBe("(B");
    expect(wzPinInitials("(2) TX - DAVID SZENDER")).toBe("(S");
    expect(wzPinInitials("(2) CT- Tyrese Barker")).toBe("(B");
    expect(wzPinInitials("(3) CT - Aleksei Chislov Sub (Alex)")).toBe("((");
    expect(wzPinInitials("Albert IL")).toBe("AI");
  });

  it("gives one letter for a one-word name and nothing for no name", () => {
    expect(wzPinInitials("Kobi")).toBe("K");
    expect(wzPinInitials("  ")).toBe("");
    expect(wzPinInitials(undefined)).toBe("");
  });
});

describe("wzPinInk", () => {
  // Workiz prints the letters white or ink, whichever stands out more: the
  // pairs seen on the live map (fill → class) all agree with that rule.
  it("puts white letters on dark fills", () => {
    for (const fill of ["#000000", "#00008B", "#008B8B", "#4169E1", "#566D76", "#5F9EA0", "#DB7093", "#D2691E"]) {
      expect(wzPinInk(fill), fill).toBe(false);
    }
  });

  it("puts ink letters on light fills", () => {
    for (const fill of ["#20B2AA", "#6495ED", "#BC8F8F", "#CD853F", "#D2B48C", "#DA70D6", "#F0E68C", "#FF8C00", "#FFA500"]) {
      expect(wzPinInk(fill), fill).toBe(true);
    }
  });
});

describe("WzMapPin", () => {
  it("draws the teardrop in the given colour with the letters on it", () => {
    render(<WzMapPin color="#008b8b" label="(B" name="(2) CT - Tyler Boucher" />);
    const pin = screen.getByTestId("wz-map-pin");
    expect(pin.querySelector("path")).toHaveAttribute("fill", "#008b8b");
    expect(screen.getByText("(B")).toBeInTheDocument();
  });

  it("draws an unassigned pin in slate with the blocked-person glyph", () => {
    render(<WzMapPin name="Unassigned" />);
    const pin = screen.getByTestId("wz-map-pin");
    expect(pin.querySelector("path")).toHaveAttribute("fill", WZ_UNASSIGNED_PIN);
    expect(pin.querySelector("[data-slot='wz-pin-unassigned']")).not.toBeNull();
  });

  it("adds a '+N' pin behind the first one when more techs share the job", () => {
    render(<WzMapPin color="#ffa500" label="(A" name="(2) AL - Treveon Andrews" more={1} />);
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getAllByTestId("wz-map-pin")).toHaveLength(2);
  });

  it("shows the name in a tooltip only while asked to", () => {
    const { rerender } = render(<WzMapPin color="#008b8b" label="(B" name="(2) CT - Tyler Boucher" />);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    rerender(<WzMapPin color="#008b8b" label="(B" name="(2) CT - Tyler Boucher" tooltip />);
    expect(screen.getByRole("tooltip")).toHaveTextContent("(2) CT - Tyler Boucher");
  });
});

describe("WzMapPinCard", () => {
  it("hangs over the pin with its title and a close ×", () => {
    const onClose = vi.fn();
    render(
      <WzMapPinCard title="Car lockout - Job #FXO1U4" onClose={onClose}>
        <p>Anna Janeh</p>
      </WzMapPinCard>,
    );
    expect(screen.getByText("Car lockout - Job #FXO1U4")).toBeInTheDocument();
    expect(screen.getByText("Anna Janeh")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
