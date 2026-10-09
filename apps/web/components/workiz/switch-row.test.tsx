import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WzSwitchRow } from "./switch-row";

/**
 * A row of Workiz's "Edit permissions for role …" list
 * (pg_admin_users_wz_10_role_dispatch): a 14px/600 title over a 14px
 * sentence, the switch at the right, a 1px #ddd rule under it, 81px apart.
 */
describe("WzSwitchRow", () => {
  it("prints the title as a heading over the sentence, the controls beside them", () => {
    render(
      <WzSwitchRow title="Dashboard" description="View dashboard statistics">
        <input type="checkbox" role="switch" aria-label="Dashboard" />
      </WzSwitchRow>,
    );
    expect(screen.getByRole("heading", { level: 5, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("View dashboard statistics")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("is ruled #ddd under it", () => {
    render(<WzSwitchRow title="Clients" description="View and manage clients" />);
    const row = document.querySelector("[data-slot=wz-switch-row]")!;
    expect(row.className).toContain("border-b");
    expect(row.className).toContain("border-wz-frame");
  });

  it("leaves the sentence out when there is none", () => {
    render(<WzSwitchRow title="Leads" />);
    expect(document.querySelector("[data-slot=wz-switch-row-description]")).toBeNull();
  });
});
