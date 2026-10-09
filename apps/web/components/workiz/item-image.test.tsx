import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { WzItemImage, WzItemImagePlaceholder } from "./item-image";

/** Workiz's item / category picture (pg_pricebook_wz_01_default, _11_categories): 40×40, 8px corners, a #cad3d6 hairline. */
describe("WzItemImagePlaceholder", () => {
  it("is Workiz's emptyPlaceholder.svg: a #ecedee square with the two grey shapes, filling its box", () => {
    const { container } = render(<WzItemImagePlaceholder />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.querySelector("rect")).toHaveAttribute("fill", "#ECEDEE");
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect(svg.getAttribute("class")).toContain("size-full");
  });
});

describe("WzItemImage", () => {
  it("draws the picture in the 40px rounded frame, lazily", () => {
    const { container } = render(<WzItemImage src="https://x.test/a.png" />);
    const frame = container.firstElementChild!;
    expect(frame.className).toContain("size-10");
    expect(frame.className).toContain("rounded-lg");
    expect(frame.className).toContain("border-wz-rule");
    expect(container.querySelector("img")).toHaveAttribute("loading", "lazy");
  });

  it("falls back to the placeholder without a picture, or when it fails to load", () => {
    const { container, rerender } = render(<WzItemImage />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg rect")).not.toBeNull();
    rerender(<WzItemImage src="https://x.test/broken.png" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg rect")).not.toBeNull();
  });
});
