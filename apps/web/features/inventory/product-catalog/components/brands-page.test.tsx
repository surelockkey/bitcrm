import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus, type Brand } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  perms: { view: true, create: true, edit: true, delete: true },
  toggle: vi.fn(),
  brands: [] as Brand[],
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (_r: string, action?: string) =>
      action ? mocks.perms[action as keyof typeof mocks.perms] : mocks.perms.view,
  }),
}));

vi.mock("../hooks", () => ({
  useBrands: () => ({ data: mocks.brands, isLoading: false }),
  useToggleBrand: () => ({ mutate: mocks.toggle, isPending: false }),
  useCreateBrand: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBrand: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { BrandsPage } from "./brands-page";

const brand = (over: Partial<Brand>): Brand => ({
  id: "b-1",
  name: "Kwikset",
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  ...over,
});

beforeEach(() => {
  mocks.perms = { view: true, create: true, edit: true, delete: true };
  mocks.toggle.mockClear();
  mocks.brands = [
    brand({ id: "b-1", name: "Kwikset", description: "Residential locks" }),
    brand({ id: "b-2", name: "Schlage", status: InventoryStatus.ARCHIVED }),
  ];
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("BrandsPage", () => {
  it("lists brands with description and status", () => {
    render(<BrandsPage />);

    expect(screen.getByText("Kwikset")).toBeInTheDocument();
    expect(screen.getByText("Residential locks")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("filters by name", async () => {
    render(<BrandsPage />);

    await user().type(screen.getByLabelText("Search brands"), "schl");

    expect(screen.getByText("Schlage")).toBeInTheDocument();
    expect(screen.queryByText("Kwikset")).not.toBeInTheDocument();
  });

  it("toggles a brand straight from the row", async () => {
    render(<BrandsPage />);

    await user().click(screen.getByRole("button", { name: "Disable Kwikset" }));

    expect(mocks.toggle).toHaveBeenCalledWith({ id: "b-1", active: false });
  });

  it("hides write controls from a read-only user", () => {
    mocks.perms = { view: true, create: false, edit: false, delete: false };
    render(<BrandsPage />);

    expect(screen.queryByRole("button", { name: /new brand/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable Kwikset" })).not.toBeInTheDocument();
  });
});
