import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzFormSectionTitle, WzInfoTip } from "./form-section-title";

/**
 * The user page's block titles ("User Details", "Labor cost per hour ⓘ",
 * pg_technicians_wz_10_user_profile): 14px/21px 600 ink, an ⓘ 4px after the
 * words whose tooltip says what the block is.
 */
describe("WzFormSectionTitle", () => {
  it("is a heading in Workiz's 14px semibold ink", () => {
    render(<WzFormSectionTitle>User Details</WzFormSectionTitle>);
    const h = screen.getByRole("heading", { name: "User Details" });
    expect(h.className).toContain("text-sm");
    expect(h.className).toContain("font-semibold");
  });

  it("carries an ⓘ that tells, on hover or focus, what the block is", async () => {
    render(<WzFormSectionTitle info="What it costs to send them out for an hour.">Labor cost per hour</WzFormSectionTitle>);
    expect(screen.getByRole("heading", { name: /Labor cost per hour/ })).toBeInTheDocument();
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("What it costs to send them out for an hour.");
  });
});

describe("WzInfoTip", () => {
  it("keeps its words in the page under an id, so a control can point at them", () => {
    render(<WzInfoTip id="tip-1" text="A manager sets this." label="Track location" />);
    expect(document.getElementById("tip-1")).toHaveTextContent("A manager sets this.");
    expect(screen.getByRole("button", { name: "About Track location" })).toBeInTheDocument();
  });
});
