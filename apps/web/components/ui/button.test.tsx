import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

/**
 * Every Button in the app wears Workiz's Button-module (main.css on
 * app.workiz.com): primary / secondary / tertiary / danger / accent pills,
 * 13px/600 ink words, and IconButton-module squares for the icon sizes.
 */
const cls = (el: HTMLElement) => el.className.split(/\s+/);

function button(props: React.ComponentProps<typeof Button>) {
  render(<Button {...props}>{props.children ?? "Go"}</Button>);
  return screen.getByRole("button");
}

describe("a button", () => {
  it("is Workiz's yellow pill by default: ink words, never white on yellow", () => {
    const b = button({});
    expect(cls(b)).toEqual(expect.arrayContaining(["bg-primary", "text-foreground", "rounded-pill"]));
    expect(cls(b)).toEqual(expect.arrayContaining(["text-[13px]", "font-semibold", "tracking-[0.2px]"]));
    expect(cls(b)).toEqual(expect.arrayContaining(["hover:bg-wz-primary-hover", "active:bg-wz-primary-active"]));
    expect(b.className).not.toContain("text-white");
  });

  it("makes `brand` the same yellow primary: every Workiz Save / Add New / Create is yellow", () => {
    const b = button({ variant: "brand" });
    expect(cls(b)).toEqual(expect.arrayContaining(["bg-primary", "text-foreground", "rounded-pill"]));
    expect(cls(b)).not.toContain("bg-brand");
    expect(b.dataset.variant).toBe("brand");
  });

  it("draws `outline` as the secondary pill: a 1px ink edge, grey when hovered or open", () => {
    const b = button({ variant: "outline" });
    expect(cls(b)).toEqual(
      expect.arrayContaining(["border-foreground", "bg-transparent", "rounded-pill", "hover:bg-wz-secondary-hover"]),
    );
    expect(cls(b)).toContain("aria-expanded:bg-wz-secondary-hover");
  });

  it("keeps `secondary` blue, as Workiz's accent pill", () => {
    const b = button({ variant: "secondary" });
    expect(cls(b)).toEqual(expect.arrayContaining(["bg-brand", "text-white", "hover:bg-wz-accent-hover"]));
  });

  it("draws `ghost` as the tertiary pill: no edge, grey when hovered", () => {
    const b = button({ variant: "ghost" });
    expect(cls(b)).toEqual(expect.arrayContaining(["bg-transparent", "hover:bg-wz-secondary-hover", "rounded-pill"]));
    expect(cls(b)).not.toContain("border-foreground");
  });

  it("makes `destructive` Workiz's solid red danger pill", () => {
    const b = button({ variant: "destructive" });
    expect(cls(b)).toEqual(expect.arrayContaining(["bg-wz-danger", "text-white", "hover:bg-wz-danger-hover"]));
  });

  it("makes `link` the Workiz blue text link", () => {
    const b = button({ variant: "link" });
    expect(cls(b)).toEqual(expect.arrayContaining(["text-wz-link", "hover:underline"]));
    expect(cls(b)).not.toContain("bg-primary");
  });

  it("sizes like Workiz: regular 32px, compact 26px, big 40px", () => {
    expect(cls(button({}))).toContain("h-8");
  });

  it.each([
    ["sm", "h-[26px]"],
    ["lg", "h-10"],
    ["xs", "h-6"],
  ] as const)("size %s is %s tall", (size, h) => {
    expect(cls(button({ size }))).toContain(h);
  });

  it("makes the icon sizes IconButton-module squares, not pills", () => {
    const b = button({ size: "icon", variant: "ghost", "aria-label": "More" });
    expect(cls(b)).toEqual(expect.arrayContaining(["size-8", "rounded-[8px]"]));
    expect(cls(b)).not.toContain("rounded-pill");
  });

  it("gives an outlined icon button the toolbar's square grey edge (Export, Fields)", () => {
    const b = button({ size: "icon-sm", variant: "outline", "aria-label": "Settings" });
    expect(cls(b)).toEqual(expect.arrayContaining(["border-input", "rounded-[4px]"]));
    expect(cls(b)).not.toContain("border-foreground");
  });

  it("greys a disabled pill the Workiz way instead of fading it", () => {
    const b = button({ disabled: true });
    expect(cls(b)).toEqual(expect.arrayContaining(["disabled:bg-wz-disabled-fill", "disabled:text-wz-outline"]));
    expect(cls(b)).not.toContain("disabled:opacity-50");
  });

  it("still lets a page override its classes", () => {
    const b = button({ className: "h-[34px] px-4" });
    expect(cls(b)).toEqual(expect.arrayContaining(["h-[34px]", "px-4"]));
    expect(cls(b)).not.toContain("h-8");
  });
});
