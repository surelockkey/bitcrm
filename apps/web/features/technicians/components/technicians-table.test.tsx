import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamRow } from "../team-list";
import { TechniciansTable } from "./technicians-table";

function row(over: Partial<TeamRow> = {}): TeamRow {
  return {
    id: "u1",
    name: "Riley Santos",
    email: "riley@slk.com",
    phone: "+14045551234",
    twoFactor: false,
    callMasking: false,
    roleId: "role-tech",
    role: "tech",
    fieldTeam: true,
    type: "regular",
    status: "active",
    createdAt: "2022-11-04T11:16:00.000Z",
    skills: ["(A-1) Door Glass Job", "Rekey lock"],
    areaIds: ["ct", "ny"],
    areas: ["SURE LOCK CT", "SURE LOCK NY"],
    ...over,
  };
}

const draw = (rows: TeamRow[], onOpen = vi.fn()) =>
  render(<TechniciansTable rows={rows} sort={{ column: "name", dir: "asc" }} onSort={vi.fn()} onOpen={onOpen} />);

const records = () => [...document.querySelectorAll("tbody tr:not([aria-hidden])")] as HTMLElement[];

describe("TechniciansTable — Workiz's Team grid", () => {
  it("has Workiz's columns, in Workiz's order", () => {
    draw([row()]);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Phone",
      "Role",
      "Field team",
      "Type",
      "Created",
      "Skills",
      "Areas",
    ]);
  });

  it("prints a row as Workiz does", () => {
    draw([row()]);
    const [r] = records();
    const cells = within(r).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Riley Santos");
    expect(within(cells[0]).getByText("riley@slk.com").className).toContain("text-wz-caption");
    expect(within(cells[1]).getByRole("link", { name: "(404) 555-1234" })).toHaveAttribute("href", "tel:+14045551234");
    expect(cells[2]).toHaveTextContent("tech");
    expect(cells[3]).toHaveTextContent("yes");
    expect(cells[4]).toHaveTextContent("User");
    expect(cells[5]).toHaveTextContent("Fri Nov 04, 2022 07:16 am");
    expect(cells[6]).toHaveTextContent("(A-1) Door Glass Job ,Rekey lock");
    expect(cells[7]).toHaveTextContent("SURE LOCK CT ,SURE LOCK NY");
  });

  it("chips 2FA under the email and Call masking under the phone, and ours: Pending / Inactive", () => {
    draw([
      row({ id: "a", twoFactor: true, callMasking: true }),
      row({ id: "b", status: "pending", fieldTeam: false, type: "subcontractor" }),
      row({ id: "c", status: "inactive" }),
    ]);
    const [a, b, c] = records();
    expect(within(a).getByText("2FA").className).toContain("bg-wz-link");
    expect(within(a).getByText("Call masking").className).toContain("bg-brand");
    expect(within(a).queryByText("Pending")).toBeNull();
    expect(within(b).getByText("Pending")).toBeInTheDocument();
    expect(b).toHaveTextContent("no");
    expect(b).toHaveTextContent("Subcontractor");
    expect(within(c).getByText("Inactive")).toBeInTheDocument();
  });

  it("has no avatar — Workiz's Team grid draws none", () => {
    draw([row()]);
    expect(document.querySelector("[data-slot=avatar]")).toBeNull();
  });

  it("opens the technician from the row, but a tap on the phone dials instead", async () => {
    const onOpen = vi.fn();
    draw([row()], onOpen);
    await userEvent.click(screen.getByText("Riley Santos"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), expect.anything());
    onOpen.mockClear();
    await userEvent.click(screen.getByRole("link", { name: "(404) 555-1234" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("is never shorter than five rows, and an empty grid is only its blank rows", () => {
    draw([]);
    expect(records()).toHaveLength(0);
    expect(document.querySelectorAll("tbody tr[aria-hidden]")).toHaveLength(5);
    expect(screen.queryByText("No Records Found")).toBeNull();
  });

  it("lets the reader drag every column", () => {
    draw([row()]);
    for (const id of ["name", "phone", "role", "fieldTeam", "type", "created", "skills", "areas"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});
