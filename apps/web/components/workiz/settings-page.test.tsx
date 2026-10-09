import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Wrench } from "lucide-react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const {
  WzSettingsHeader,
  WzSettingsBar,
  WzColorBar,
  WzSettingsBlock,
  WzSettingsTile,
  wzShowRows,
  WZ_SHOW_OPTIONS,
} = await import("./settings-page");

describe("wzShowRows — Workiz's Show: Active / Disabled / All", () => {
  const rows = [
    { id: "a", active: true },
    { id: "b", active: false },
    { id: "c", active: true },
  ];
  it("keeps the active ones for Active, the rest for Disabled, every one for All", () => {
    expect(wzShowRows(rows, "active").map((r) => r.id)).toEqual(["a", "c"]);
    expect(wzShowRows(rows, "disabled").map((r) => r.id)).toEqual(["b"]);
    expect(wzShowRows(rows, "all").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("reads activity through the given getter, for catalogs that name it otherwise", () => {
    const areas = [{ id: "x", on: false }, { id: "y", on: true }];
    expect(wzShowRows(areas, "active", (r) => r.on).map((r) => r.id)).toEqual(["y"]);
  });

  it("offers Workiz's three choices in Workiz's order", () => {
    expect(WZ_SHOW_OPTIONS.map((o) => o.label)).toEqual(["Active", "Disabled", "All"]);
  });
});

describe("WzSettingsHeader — the grey band over a settings page", () => {
  it("names the page with an h2 and says what it is for", () => {
    render(<WzSettingsHeader icon={<Wrench />} title="Job Types" description="Add your job types and assign to jobs." />);
    expect(screen.getByRole("heading", { level: 2, name: "Job Types" })).toBeInTheDocument();
    expect(screen.getByText("Add your job types and assign to jobs.")).toBeInTheDocument();
  });
});

describe("WzSettingsBar — Show: and the yellow add button", () => {
  it("shows the Show: select only when asked, and the action at the end", () => {
    const { rerender } = render(<WzSettingsBar action={<button type="button">Add New</button>} />);
    expect(screen.queryByText("Show:")).toBeNull();
    expect(screen.getByRole("button", { name: "Add New" })).toBeInTheDocument();

    rerender(<WzSettingsBar show="active" onShowChange={() => {}} action={<button type="button">Add New</button>} />);
    expect(screen.getByText("Show:")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Show" })).toHaveTextContent("Active");
  });
});

describe("WzColorBar — the Color column's swatch", () => {
  it("is a 100×16 bar in the colour, named for screen readers", () => {
    render(<WzColorBar color="#e35a36" label="Red" />);
    const bar = screen.getByRole("img", { name: "Red" });
    expect(bar).toHaveStyle({ backgroundColor: "#e35a36" });
    expect(bar.className).toMatch(/w-\[100px\]/);
  });

  it("takes a class instead of a colour (a token palette)", () => {
    render(<WzColorBar className="bg-red-token" label="Red" />);
    expect(screen.getByRole("img", { name: "Red" }).className).toMatch(/bg-red-token/);
  });
});

describe("WzSettingsBlock + WzSettingsTile — the settings home", () => {
  it("draws a heading per block and a link per tile, its title its name", async () => {
    render(
      <WzSettingsBlock title="Job Settings">
        <WzSettingsTile href="/settings/job-types" title="Job Types" icon={<Wrench />} hint="Kinds of work" />
      </WzSettingsBlock>,
    );
    const block = screen.getByRole("region", { name: "Job Settings" });
    const link = within(block).getByRole("link", { name: "Job Types" });
    expect(link).toHaveAttribute("href", "/settings/job-types");
    // The description rides along as the tooltip, not as words on the tile.
    expect(link).toHaveAttribute("title", "Kinds of work");
    await userEvent.hover(link);
  });
});
