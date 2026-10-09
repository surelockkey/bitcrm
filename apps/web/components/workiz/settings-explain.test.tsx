import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WzSettingsExplain } from "./settings-explain";

/**
 * The band over Workiz's settings lists (react_components_explain — Team,
 * Job Types, Service Areas, Taxes; pg_technicians_wz_01_team): an icon and a
 * thin h2 behind a rule, then what the page is for.
 */
describe("WzSettingsExplain", () => {
  it("names the page with its heading and says what it is for beside it", () => {
    render(
      <WzSettingsExplain icon={<svg data-testid="glyph" />} title="Team">
        Manage and add users to your team
      </WzSettingsExplain>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("Manage and add users to your team").tagName).toBe("P");
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
  });

  it("is the #fafcfc band, the title behind a #ddd rule", () => {
    render(<WzSettingsExplain title="Team">x</WzSettingsExplain>);
    const band = document.querySelector("[data-slot=wz-settings-explain]")!;
    expect(band.className).toContain("bg-wz-band");
    const title = document.querySelector("[data-slot=wz-settings-explain-title]")!;
    expect(title.className).toContain("border-r");
    expect(title.className).toContain("border-wz-frame");
  });

  it("draws the links row only when given links", () => {
    const { rerender } = render(<WzSettingsExplain title="Team">x</WzSettingsExplain>);
    expect(document.querySelector("[data-slot=wz-settings-explain-links]")).toBeNull();
    rerender(
      <WzSettingsExplain title="Team" links={<a href="/guide">Read guide</a>}>
        x
      </WzSettingsExplain>,
    );
    expect(screen.getByRole("link", { name: "Read guide" })).toBeInTheDocument();
  });
});
