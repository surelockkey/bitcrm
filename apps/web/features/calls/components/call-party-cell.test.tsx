import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CallPartyCell } from "./call-party-cell";

const can = vi.fn(() => true);
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (...args: unknown[]) => can(...(args as [])) }),
}));

describe("CallPartyCell", () => {
  it("leads with the user's name, linked, and the number beneath", () => {
    render(
      <CallPartyCell
        party={{ userId: "u1", label: "Nazarii", number: "+12624061115" }}
      />,
    );
    expect(screen.getByRole("link", { name: "Nazarii" })).toHaveAttribute(
      "href",
      "/admin/users?user=u1",
    );
    expect(screen.getByText("+1 262 406 1115")).toBeInTheDocument();
  });

  it("shows just the number when no user is on that side", () => {
    render(<CallPartyCell party={{ number: "+380958601427" }} />);
    expect(screen.getByText("+380 95 860 1427")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("drops the link for viewers who can't open users", () => {
    can.mockReturnValueOnce(false);
    render(<CallPartyCell party={{ userId: "u1", label: "Nazarii" }} />);
    expect(screen.getByText("Nazarii")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("doesn't repeat a legacy client: leg as a number", () => {
    render(
      <CallPartyCell
        party={{ userId: "u1", label: "Nazarii", number: "client:u1" }}
      />,
    );
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });
});
