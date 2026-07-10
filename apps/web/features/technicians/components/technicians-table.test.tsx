import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TechnicianProfile, User } from "@bitcrm/types";
import { TechniciansTable } from "./technicians-table";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function profile(over: Partial<TechnicianProfile>): TechnicianProfile {
  return {
    userId: "u1",
    callMaskingEnabled: false,
    gpsTrackingEnabled: false,
    mobileAppInstalled: false,
    status: "active",
    laborCostPerHour: 45,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const userMap = new Map<string, User>([
  ["u1", { id: "u1", firstName: "Riley", lastName: "Santos", email: "riley@slk", department: "Field" } as User],
]);

describe("TechniciansTable", () => {
  it("joins the user name and shows status + labor", () => {
    render(<TechniciansTable technicians={[profile({})]} userMap={userMap} />);
    expect(screen.getByText("Riley Santos")).toBeInTheDocument();
    expect(screen.getByText("riley@slk")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("$45.00/hr")).toBeInTheDocument();
  });

  it("falls back to the userId when the user isn't loaded", () => {
    render(<TechniciansTable technicians={[profile({ userId: "u9" })]} userMap={userMap} />);
    expect(screen.getByText("Unknown technician")).toBeInTheDocument();
  });

  it("navigates to the detail on row click", async () => {
    render(<TechniciansTable technicians={[profile({})]} userMap={userMap} />);
    await userEvent.click(screen.getByText("Riley Santos"));
    expect(push).toHaveBeenCalledWith("/technicians/u1");
  });
});
