import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("knows Workiz's pill and chip corners are corners, so a later radius wins", () => {
    // `rounded-pill` / `rounded-chip` are this app's own radius tokens
    // (globals.css); tailwind-merge has to be told, or a page's
    // `rounded-[8px]` and the primitive's `rounded-pill` would both survive.
    expect(cn("rounded-pill", "rounded-[8px]")).toBe("rounded-[8px]");
    expect(cn("rounded-[8px]", "rounded-pill")).toBe("rounded-pill");
    expect(cn("rounded-chip", "rounded-md")).toBe("rounded-md");
  });

  it("still merges everything else the stock way", () => {
    expect(cn("h-8 px-4", "h-[34px]")).toBe("px-4 h-[34px]");
    expect(cn("bg-primary text-foreground", "bg-wz-danger text-white")).toBe("bg-wz-danger text-white");
  });
});
