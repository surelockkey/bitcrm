import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WzExplainHeader } from "./explain-header";

/** Workiz's explanation block over a section (pg_pricebook_wz_01_default): title | rule | what the page is for. */
describe("WzExplainHeader", () => {
  it("is the page's h1, then the words that explain it, behind a rule", () => {
    render(<WzExplainHeader title="Price book">Price book streamlines your estimating process</WzExplainHeader>);
    const h1 = screen.getByRole("heading", { level: 1, name: "Price book" });
    expect(h1.className).toContain("text-[31px]");
    const text = screen.getByText("Price book streamlines your estimating process");
    expect(text.tagName).toBe("P");
    expect(document.querySelector("[data-slot=wz-explain-rule]")).not.toBeNull();
  });

  it("is a 120px #fafcfc band", () => {
    render(<WzExplainHeader title="Price book">x</WzExplainHeader>);
    const band = document.querySelector("[data-slot=wz-explain-header]")!;
    expect(band.className).toContain("h-[120px]");
    expect(band.className).toContain("bg-wz-band");
  });
});
