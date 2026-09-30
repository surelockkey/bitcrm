import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, UserContainerAccess } from "@bitcrm/types";
import type { UserContainer } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import type { StockLocation } from "@/features/inventory/stock/lib";

type Mutate = (vars: unknown, opts?: { onSuccess?: () => void }) => void;

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  rows: [] as UserContainer[],
  locations: [] as StockLocation[],
  assign: vi.fn(),
  user: undefined as { id: string; firstName: string; lastName: string; email: string } | undefined,
  userLookups: [] as (string | undefined)[],
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));

vi.mock("../hooks", () => ({
  useUserContainers: () => ({ data: mocks.rows, isLoading: false, isError: false }),
  useUserNames: () => ({ names: new Map([["u2", "Pavlo Bondar"]]), isLoading: false }),
  useAssignUserContainer: () => ({
    isPending: false,
    mutate: ((vars, opts) => {
      mocks.assign(vars);
      opts?.onSuccess?.();
    }) as Mutate,
  }),
}));

vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({ data: mocks.locations, isLoading: false, isError: false }),
}));

vi.mock("@/features/users/hooks", () => ({
  useUser: (id?: string) => {
    mocks.userLookups.push(id);
    return { data: id ? mocks.user : undefined, isLoading: false, isError: false };
  },
}));

import { AssignContainerDialog } from "./assign-container-dialog";

const active = InventoryStatus.ACTIVE;
const van = (id: string, name: string, over: Partial<StockLocation> = {}): StockLocation => ({
  type: "container",
  id,
  name,
  status: active,
  ...over,
});
const row = (over: Partial<UserContainer>): UserContainer => ({
  userId: "u1",
  userName: "Taras Koval",
  access: UserContainerAccess.CONTAINER,
  containerId: "c1",
  containerName: "Van 1",
  limited: false,
  updatedAt: "",
  ...over,
});

beforeEach(() => {
  mocks.denied = new Set();
  mocks.assign.mockReset();
  mocks.userLookups = [];
  mocks.user = undefined;
  mocks.rows = [
    row({}),
    // A backfill row: the name is the user id.
    row({ userId: "u2", userName: "u2", containerId: "c2", containerName: "Van 2" }),
  ];
  mocks.locations = [
    { type: "warehouse", id: "w1", name: "Main", status: active },
    van("c1", "Van 1"),
    van("c2", "Van 2"),
    van("c3", "Van 3", { technicianId: "u7", technicianName: "Oleh" }),
    van("c9", "Old van", { status: InventoryStatus.ARCHIVED }),
  ];
});

/** `user: null` — the page didn't have the row (a deep link). */
function open(userId = "u1", user: { userId: string; name: string } | null = { userId, name: "Taras Koval" }) {
  const onOpenChange = vi.fn();
  renderWithClient(
    <AssignContainerDialog userId={userId} user={user ?? undefined} open onOpenChange={onOpenChange} />,
  );
  return { onOpenChange, dialog: () => screen.getByRole("dialog", { name: "Assign container" }) };
}

const radio = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) });

async function pick(name: RegExp) {
  await userEvent.click(screen.getByRole("combobox", { name: "Container" }));
  await userEvent.click(screen.getByRole("option", { name }));
}

describe("AssignContainerDialog — what the user works from now", () => {
  it("names the user and preselects their container", () => {
    const { dialog } = open();
    expect(within(dialog()).getByText("Taras Koval")).toBeInTheDocument();
    expect(radio("Specific container")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Container" })).toHaveTextContent("Van 1");
  });

  it("preselects All locations for someone with that access", () => {
    mocks.rows = [row({ access: UserContainerAccess.ALL, containerId: undefined })];
    open();
    expect(radio("All locations")).toBeChecked();
    expect(screen.queryByRole("combobox", { name: "Container" })).toBeNull();
  });

  it("preselects the legacy van for someone without a row, and says where it comes from", () => {
    open("u7", { userId: "u7", name: "Oleh Petrenko" });
    expect(radio("Specific container")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "Container" })).toHaveTextContent("Van 3");
    expect(screen.getByText(/technician link/i)).toBeInTheDocument();
  });

  it("looks the user up when the page didn't have them", () => {
    mocks.user = { id: "u8", firstName: "Iryna", lastName: "Hnatiuk", email: "i@x.com" };
    open("u8", null);
    expect(mocks.userLookups).toContain("u8");
    expect(screen.getByText("Iryna Hnatiuk")).toBeInTheDocument();
  });
});

describe("AssignContainerDialog — the container picker", () => {
  it("offers the active vans only, each with who already uses it", async () => {
    open();
    await userEvent.click(screen.getByRole("combobox", { name: "Container" }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Van 1Taras Koval", "Van 2Pavlo Bondar", "Van 3Oleh"]);
  });

  // Several users may share a van — the note says so, it doesn't stop them.
  it("says who else uses the van picked, and still saves", async () => {
    open();
    await pick(/^Van 2/);
    expect(screen.getByText("Also used by Pavlo Bondar.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.assign).toHaveBeenCalledWith({
      userId: "u1",
      body: { userName: "Taras Koval", access: UserContainerAccess.CONTAINER, containerId: "c2", limited: false },
    });
  });

  it("has no note for a van nobody else uses", async () => {
    open();
    expect(screen.queryByText(/Also used by/)).toBeNull();
  });
});

describe("AssignContainerDialog — saving", () => {
  it("saves a container with Limited, then closes", async () => {
    const { onOpenChange } = open();
    await pick(/^Van 3/);
    await userEvent.click(screen.getByRole("switch", { name: "Limited to this container" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toHaveAttribute("data-variant", "default");
    await userEvent.click(save);
    expect(mocks.assign).toHaveBeenCalledWith({
      userId: "u1",
      body: { userName: "Taras Koval", access: UserContainerAccess.CONTAINER, containerId: "c3", limited: true },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves All locations and No access without a container", async () => {
    open();
    await userEvent.click(radio("All locations"));
    expect(screen.queryByRole("switch", { name: "Limited to this container" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.assign).toHaveBeenLastCalledWith({
      userId: "u1",
      body: { userName: "Taras Koval", access: UserContainerAccess.ALL },
    });
  });

  it("needs a van picked for Specific container", async () => {
    open("u9", { userId: "u9", name: "Nina" });
    expect(radio("Specific container")).toBeChecked();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await pick(/^Van 1/);
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("closes without a request when nothing changed", async () => {
    const { onOpenChange } = open();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Saving the van a legacy link already names still writes the row.
  it("writes a row for a legacy user even when the van stays the same", async () => {
    open("u7", { userId: "u7", name: "Oleh Petrenko" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.assign).toHaveBeenCalledWith({
      userId: "u7",
      body: { userName: "Oleh Petrenko", access: UserContainerAccess.CONTAINER, containerId: "c3", limited: false },
    });
  });
});

describe("AssignContainerDialog — without containers.edit", () => {
  it("is read-only", () => {
    mocks.denied.add("containers.edit");
    open();
    expect(screen.getByText("You have view-only access to containers.")).toBeInTheDocument();
    for (const r of screen.getAllByRole("radio")) expect(r).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Container" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    // The footer's Close, besides the corner ✕.
    expect(screen.getAllByRole("button", { name: "Close" }).some((b) => b.textContent === "Close")).toBe(true);
  });
});
