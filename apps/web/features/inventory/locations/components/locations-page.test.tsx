import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LocationRow } from "../lib";

const mocks = vi.hoisted(() => ({
  perms: { view: true, create: true, edit: true, delete: true },
  rows: [] as LocationRow[],
  stock: {
    rows: [] as unknown[],
    totals: { onHand: 0, totalCost: 0, saleValue: 0 },
    isLoading: false,
    isError: false,
  },
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (_r: string, action?: string) =>
      action ? mocks.perms[action as keyof typeof mocks.perms] : mocks.perms.view,
  }),
}));

vi.mock("../hooks", () => ({
  useLocations: () => ({ rows: mocks.rows, isLoading: false, isError: false }),
  useLocationStockView: () => mocks.stock,
}));

import { LocationsPage } from "./locations-page";

const row = (over: Partial<LocationRow>): LocationRow => ({
  id: "w-1",
  kind: "warehouse",
  name: "STORE",
  description: "Main shelf room",
  active: true,
  href: "/inventory/warehouses/w-1",
  ...over,
});

beforeEach(() => {
  mocks.perms = { view: true, create: true, edit: true, delete: true };
  mocks.rows = [
    row({}),
    row({
      id: "c-1",
      kind: "container",
      name: "(AZ) Eli Szender",
      description: "2021 Nissan NV200 · Plate C028196",
      href: "/inventory/containers/c-1",
    }),
    row({ id: "c-2", kind: "container", name: "(CT) Spare van", description: "", active: false }),
  ];
  mocks.stock = {
    rows: [
      {
        productId: "p-1",
        name: "Kwikset deadbolt",
        sku: "KW-DB-1",
        quantity: 12,
        price: 39.99,
        cost: 18.5,
        isLow: false,
      },
    ],
    totals: { onHand: 12, totalCost: 222, saleValue: 479.88 },
    isLoading: false,
    isError: false,
  };
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("LocationsPage", () => {
  it("puts warehouses and vans in one table with their descriptions", () => {
    render(<LocationsPage />);

    expect(screen.getByText("STORE")).toBeInTheDocument();
    expect(screen.getByText("(AZ) Eli Szender")).toBeInTheDocument();
    expect(screen.getByText("2021 Nissan NV200 · Plate C028196")).toBeInTheDocument();
  });

  it("badges an archived location 'Not in use' instead of renaming it", () => {
    render(<LocationsPage />);

    expect(screen.getByText("Not in use")).toBeInTheDocument();
    // Workiz prefixes the name with "N/A "; ours stays clean.
    expect(screen.getByText("(CT) Spare van")).toBeInTheDocument();
  });

  it("filters the table", async () => {
    render(<LocationsPage />);

    await user().type(screen.getByLabelText("Search locations"), "eli");

    expect(screen.getByText("(AZ) Eli Szender")).toBeInTheDocument();
    expect(screen.queryByText("STORE")).not.toBeInTheDocument();
  });

  it("opens Manage stock with that location's rows and cent-exact totals", async () => {
    render(<LocationsPage />);

    await user().click(screen.getByRole("button", { name: "Manage stock for STORE" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Kwikset deadbolt")).toBeInTheDocument();
    expect(screen.getByText("$479.88")).toBeInTheDocument();
    expect(screen.getByText("$222.00")).toBeInTheDocument();
  });

  it("renders Move and Return per stock row but leaves them inert for now", async () => {
    render(<LocationsPage />);
    await user().click(screen.getByRole("button", { name: "Manage stock for STORE" }));

    const move = screen.getByRole("button", { name: "Move Kwikset deadbolt" });
    const ret = screen.getByRole("button", { name: "Return Kwikset deadbolt" });

    // Deliberately unwired until the Move Item flow lands — clicking must not
    // close the dialog or blow up.
    await user().click(move);
    await user().click(ret);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("tells a read-only user they cannot manage stock", () => {
    mocks.perms = { view: true, create: false, edit: false, delete: false };
    render(<LocationsPage />);

    expect(
      screen.queryByRole("button", { name: "Manage stock for STORE" }),
    ).not.toBeInTheDocument();
  });
});
