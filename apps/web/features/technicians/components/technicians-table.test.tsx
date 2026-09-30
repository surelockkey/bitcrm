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

/** Стабільний перший кадр: оголошені ширини, які можна тягнути. */
describe("TechniciansTable — a stable first frame", () => {
  const render1 = () => render(<TechniciansTable technicians={[profile({})]} userMap={userMap} />);

  it("lays the columns out at declared widths, not by content", () => {
    const { container } = render1();
    expect(container.querySelector("table")?.className).toContain("table-fixed");
  });

  it("declares a width for every column", () => {
    const { container } = render1();
    const cols = [...container.querySelectorAll("colgroup col")];
    expect(cols).toHaveLength(container.querySelectorAll("thead th").length);
    for (const col of cols) expect((col as HTMLElement).style.width).not.toBe("");
  });

  it("lets no body cell set a width of its own", () => {
    const { container } = render1();
    for (const td of [...container.querySelectorAll("tbody td")]) {
      for (const cls of td.className.split(/\s+/)) {
        expect(cls).not.toMatch(/^(min-w-|max-w-|w-)/);
      }
      expect((td as HTMLElement).style.width).toBe("");
    }
  });

  it("puts a resize handle on every header", () => {
    render1();
    for (const id of ["technician", "department", "status", "labor", "open"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
