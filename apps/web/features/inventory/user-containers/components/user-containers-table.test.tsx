import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserContainerAccess } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import type { Assignment } from "../lib";
import { UserContainersTable, type UserContainerRow } from "./user-containers-table";

const assignment = (over: Partial<Assignment>): Assignment => ({
  access: UserContainerAccess.CONTAINER,
  containerId: "c1",
  containerName: "Van 1",
  limited: false,
  legacy: false,
  updatedAt: "2026-09-28T10:00:00.000Z",
  ...over,
});

const ROWS: UserContainerRow[] = [
  { userId: "u1", name: "Taras Koval", email: "taras@x.com", role: "technician", assignment: assignment({ limited: true }) },
  {
    userId: "u2",
    name: "Olha Melnyk",
    role: "admin",
    assignment: assignment({ access: UserContainerAccess.ALL, containerId: undefined, containerName: undefined }),
  },
  {
    userId: "u3",
    name: "Pavlo Bondar",
    assignment: assignment({ containerId: "c3", containerName: "Van 3", legacy: true, updatedAt: undefined }),
  },
  { userId: "u4", name: "Never Set", assignment: assignment({ access: null, containerId: undefined }) },
];

const CHOICES = [
  { value: "all", label: "All" },
  { value: "none", label: "No access" },
  { value: "container:c1", label: "Van 1" },
];

function table(over: Partial<Parameters<typeof UserContainersTable>[0]> = {}) {
  const onAssign = vi.fn();
  renderWithClient(
    <UserContainersTable rows={ROWS} choices={CHOICES} canEdit onAssign={onAssign} {...over} />,
  );
  return { onAssign };
}

const box = (name: string) => screen.getByRole("combobox", { name: `Location — ${name}` });
const restricted = (name: string) => screen.getByRole("switch", { name: `Restricted — ${name}` });

/** Workiz's User locations grid (pg_inventory_wz_02_user-locations). */
describe("UserContainersTable", () => {
  it("lists Name · Role · Location · Restricted, and BitCRM's Updated", () => {
    table();
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Name",
      "Role",
      "Location",
      "Restricted",
      "Updated",
    ]);
  });

  it("prints the name and the role; the email is on hover", () => {
    table();
    expect(screen.getByText("Taras Koval")).toHaveAttribute("title", "taras@x.com");
    expect(screen.getByText("technician")).toBeInTheDocument();
  });

  it("shows a user's one van in the box, Restricted switched on when limited", () => {
    table();
    expect(box("Taras Koval")).toHaveTextContent("Van 1");
    expect(restricted("Taras Koval")).toHaveAttribute("aria-checked", "true");
    expect(restricted("Taras Koval")).toHaveTextContent("Yes");
  });

  it("shows All, with Restricted off and locked — there is no one van to keep to", () => {
    table();
    expect(box("Olha Melnyk")).toHaveTextContent("All");
    expect(restricted("Olha Melnyk")).toBeDisabled();
    expect(restricted("Olha Melnyk")).toHaveTextContent("No");
  });

  it("names a van that comes from the old technician link, even when it is not on the list", () => {
    table();
    expect(box("Pavlo Bondar")).toHaveTextContent("Van 3 (legacy)");
  });

  it("says Not set for someone never assigned", () => {
    table();
    expect(box("Never Set")).toHaveTextContent("Not set");
  });

  it("saves a pick at once", async () => {
    const { onAssign } = table();
    await userEvent.click(box("Olha Melnyk"));
    await userEvent.click(await screen.findByRole("option", { name: "No access" }));
    expect(onAssign).toHaveBeenCalledWith("u2", { userName: "Olha Melnyk", access: UserContainerAccess.NONE });
  });

  it("lifts the restriction with the switch, keeping the van", async () => {
    const { onAssign } = table();
    await userEvent.click(restricted("Taras Koval"));
    expect(onAssign).toHaveBeenCalledWith("u1", {
      userName: "Taras Koval",
      access: UserContainerAccess.CONTAINER,
      containerId: "c1",
      limited: false,
    });
  });

  it("holds a row's controls while it saves, and every row's without containers.edit", () => {
    const { unmount } = renderWithClient(
      <UserContainersTable rows={ROWS} choices={CHOICES} canEdit saving="u1" onAssign={vi.fn()} />,
    );
    expect(box("Taras Koval")).toBeDisabled();
    expect(box("Olha Melnyk")).toBeEnabled();
    unmount();
    table({ canEdit: false });
    expect(box("Olha Melnyk")).toBeDisabled();
    expect(restricted("Taras Koval")).toBeDisabled();
  });

  it("left-aligns every header and cell", () => {
    table();
    for (const cell of document.querySelectorAll("th, td")) expect(cell.className).not.toMatch(/text-right/);
  });
});
