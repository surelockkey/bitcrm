import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzDrawer, WzDrawerSection } from "./drawer";

describe("WzDrawer — the older band head", () => {
  it("is white with the title 24px in by default, and a grey band with the title centred on `band`", () => {
    const { unmount } = render(
      <WzDrawer open onOpenChange={() => {}} title="Visible fields">
        x
      </WzDrawer>,
    );
    const plain = document.querySelector("[data-head]")!;
    expect(plain.getAttribute("data-head")).toBe("plain");
    expect(plain.className).toContain("justify-between");
    unmount();

    render(
      <WzDrawer open onOpenChange={() => {}} title="Dashboard widgets" head="band" width={320}>
        x
      </WzDrawer>,
    );
    const band = document.querySelector("[data-head]")!;
    expect(band.className).toContain("bg-muted");
    expect(band.className).toContain("justify-center");
    expect(screen.getByRole("dialog", { name: "Dashboard widgets" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

const cls = (el: Element | null) => (el?.className ?? "").toString().split(/\s+/);

describe("WzDrawer", () => {
  function drawer(onOpenChange = vi.fn()) {
    render(
      <WzDrawer
        open
        onOpenChange={onOpenChange}
        title="Visible fields"
        footer={<button type="button">Save fields</button>}
      >
        <WzDrawerSection title="Used fields">rows</WzDrawerSection>
      </WzDrawer>,
    );
    return onOpenChange;
  }

  it("is a 422px panel on the right, named by its 18px/600 title", () => {
    drawer();
    const panel = screen.getByRole("dialog", { name: "Visible fields" });
    expect(cls(panel)).toEqual(expect.arrayContaining(["w-[422px]", "right-0"]));
    expect(cls(screen.getByText("Visible fields"))).toEqual(expect.arrayContaining(["text-lg", "font-semibold"]));
  });

  it("dims the page with #666 at 60%, without blur (Workiz's right-pane-container)", () => {
    drawer();
    const overlay = document.querySelector("[data-slot=wz-drawer-overlay]");
    expect(cls(overlay)).toContain("bg-wz-scrim/60");
    expect((overlay?.className ?? "").toString()).not.toContain("blur");
  });

  it("keeps its footer opaque, so the list scrolls under it rather than showing through", () => {
    // audit_pixels L16: the jobs list's own panel let "End" show behind Cancel.
    drawer();
    const footer = screen.getByRole("button", { name: "Save fields" }).parentElement!;
    expect(cls(footer)).toEqual(expect.arrayContaining(["bg-popover", "shrink-0"]));
  });

  it("is a 65px footer with the pills 21px down (list_02 / pg_contacts_wz_08: rows end at 935, pills at 956)", () => {
    drawer();
    const footer = screen.getByRole("button", { name: "Save fields" }).parentElement!;
    expect(cls(footer)).toEqual(expect.arrayContaining(["h-[65px]", "items-start", "pt-[21px]"]));
  });

  it("closes from its ×", async () => {
    const onOpenChange = drawer();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("labels a section the Workiz way: 12px/500 capitals in #9ea6aa", () => {
    drawer();
    expect(cls(screen.getByText("Used fields"))).toEqual(
      expect.arrayContaining(["text-xs", "font-medium", "uppercase", "text-wz-outline"]),
    );
  });
});
