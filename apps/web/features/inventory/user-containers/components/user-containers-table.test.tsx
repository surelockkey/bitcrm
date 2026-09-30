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
  { userId: "u1", name: "Taras Koval", email: "taras@x.com", assignment: assignment({ limited: true }) },
  {
    userId: "u2",
    name: "Olha Melnyk",
    assignment: assignment({ access: UserContainerAccess.ALL, containerId: undefined, containerName: undefined }),
  },
  {
    userId: "u3",
    name: "Pavlo Bondar",
    assignment: assignment({ containerId: "c3", containerName: "Van 3", legacy: true, updatedAt: undefined }),
  },
  { userId: "u4", name: "Ivan Shevchuk", assignment: { access: null, limited: false, legacy: false } },
];

function table(rows = ROWS) {
  const onAssign = vi.fn();
  const utils = renderWithClient(<UserContainersTable rows={rows} onAssign={onAssign} />);
  const headers = () =>
    [...utils.container.querySelectorAll("thead th")].map((th) => th.getAttribute("aria-label"));
  const cells = (userId: string) => {
    const tr = utils.container.querySelector(`tbody tr[data-user="${userId}"]`) as HTMLElement;
    return [...tr.querySelectorAll("td")].map((td) => td.textContent);
  };
  return { ...utils, onAssign, headers, cells };
}

describe("UserContainersTable", () => {
  it("lists User · Container · Access · Limited · Updated · Actions", () => {
    expect(table().headers()).toEqual(["User", "Container", "Access", "Limited", "Updated", "Actions"]);
  });

  it("shows a user's one container, limited or not", () => {
    const [user, container, access, limited, updated] = table().cells("u1");
    expect(user).toContain("Taras Koval");
    expect(container).toBe("Van 1");
    expect(access).toBe("Container");
    expect(limited).toBe("Yes");
    expect(updated).toBe("Sep 28, 2026");
  });

  it("shows All locations with no container", () => {
    const [, container, access, limited] = table().cells("u2");
    expect(container).toBe("—");
    expect(access).toBe("All locations");
    expect(limited).toBe("—");
  });

  it("marks a van that comes from the old technician link", () => {
    const [, container, access] = table().cells("u3");
    expect(container).toBe("Van 3legacy");
    expect(access).toBe("Container");
  });

  it("says Not set for someone never assigned", () => {
    const [, container, access] = table().cells("u4");
    expect(container).toBe("—");
    expect(access).toBe("Not set");
  });

  it("left-aligns every header and cell", () => {
    const { container } = table();
    for (const el of container.querySelectorAll("thead th, tbody td")) {
      expect(el.className).not.toMatch(/text-right|justify-end/);
    }
  });

  it("opens the Assign popup from the row and from its button", async () => {
    const { onAssign } = table();
    await userEvent.click(screen.getByText("Olha Melnyk"));
    expect(onAssign).toHaveBeenLastCalledWith("u2");
    await userEvent.click(screen.getByRole("button", { name: "Assign a container to Taras Koval" }));
    expect(onAssign).toHaveBeenLastCalledWith("u1");
    expect(onAssign).toHaveBeenCalledTimes(2);
  });
});

describe("UserContainersTable — a stable first frame", () => {
  it("is fixed-layout with a declared, resizable width per column, fitting 1250px", () => {
    const { container } = table();
    expect(container.querySelector("table")?.className).toContain("table-fixed");
    const cols = [...container.querySelectorAll("colgroup col")] as HTMLElement[];
    expect(cols).toHaveLength(6);
    expect(cols.reduce((n, c) => n + parseFloat(c.style.width), 0)).toBeLessThanOrEqual(1250);
    for (const id of ["user", "container", "access", "limited", "updated", "actions"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });

  it("clips every cell and scrolls sideways instead of clipping the table", () => {
    const { container } = table();
    for (const td of container.querySelectorAll("tbody td")) {
      expect(td.className).toMatch(/truncate|overflow-hidden/);
    }
    expect(container.querySelector("[data-slot=table-frame]")?.className).toMatch(/overflow-x-auto/);
  });
});
