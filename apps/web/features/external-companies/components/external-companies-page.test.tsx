import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExternalCompany } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  perms: { view: true, create: true, edit: true, delete: true },
  toggle: vi.fn(),
  del: vi.fn(),
  companies: [] as ExternalCompany[],
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({
    can: (_r: string, action?: string) =>
      action ? mocks.perms[action as keyof typeof mocks.perms] : mocks.perms.view,
  }),
}));

vi.mock("../hooks", () => ({
  useExternalCompanies: () => ({ data: mocks.companies, isLoading: false }),
  useToggleExternalCompany: () => ({ mutate: mocks.toggle, isPending: false }),
  useDeleteExternalCompany: () => ({ mutate: mocks.del, isPending: false }),
  useCreateExternalCompany: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateExternalCompany: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ExternalCompaniesPage } from "./external-companies-page";

const co = (over: Partial<ExternalCompany>): ExternalCompany => ({
  id: "ec-1",
  name: "Agero",
  active: false,
  createdBy: "admin",
  createdAt: "",
  updatedAt: "",
  ...over,
});

beforeEach(() => {
  mocks.perms = { view: true, create: true, edit: true, delete: true };
  mocks.toggle.mockClear();
  mocks.del.mockClear();
  mocks.companies = [
    co({ id: "ec-1", name: "Agero", active: false }),
    co({
      id: "ec-2",
      name: "Allied Dispatch Solutions",
      email: "Tammy.Killen@allieddispatch.com",
      address: "500 Borla Dr, Johnson City, TN 37604",
      phone: "+18552810219",
      active: true,
    }),
  ];
});

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("ExternalCompaniesPage", () => {
  it("lists every company with its contact details and status", () => {
    render(<ExternalCompaniesPage />);

    expect(screen.getByText("Agero")).toBeInTheDocument();
    expect(screen.getByText("Allied Dispatch Solutions")).toBeInTheDocument();
    expect(screen.getByText("Tammy.Killen@allieddispatch.com")).toBeInTheDocument();
    expect(screen.getByText("500 Borla Dr, Johnson City, TN 37604")).toBeInTheDocument();
    expect(screen.getByText("(855) 281-0219")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("filters the list as you search, including by phone fragment", async () => {
    const u = user();
    render(<ExternalCompaniesPage />);
    const search = screen.getByLabelText(/search external companies/i);

    await u.type(search, "allied");
    expect(screen.queryByText("Agero")).not.toBeInTheDocument();
    expect(screen.getByText("Allied Dispatch Solutions")).toBeInTheDocument();

    await u.clear(search);
    await u.type(search, "2810219");
    expect(screen.getByText("Allied Dispatch Solutions")).toBeInTheDocument();
    expect(screen.queryByText("Agero")).not.toBeInTheDocument();
  });

  it("toggles a company straight from the row", async () => {
    const u = user();
    render(<ExternalCompaniesPage />);

    // Agero is Disabled → its action reads "Enable".
    await u.click(screen.getAllByRole("button", { name: "Enable" })[0]);
    expect(mocks.toggle).toHaveBeenCalledWith({ id: "ec-1", active: true });

    await u.click(screen.getAllByRole("button", { name: "Disable" })[0]);
    expect(mocks.toggle).toHaveBeenCalledWith({ id: "ec-2", active: false });
  });

  it("opens the edit dialog prefilled from the row", async () => {
    const u = user();
    render(<ExternalCompaniesPage />);

    await u.click(screen.getByRole("button", { name: /edit allied dispatch solutions/i }));

    expect(screen.getByText("Edit Allied Dispatch Solutions")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Allied Dispatch Solutions")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Tammy.Killen@allieddispatch.com")).toBeInTheDocument();
  });

  it("hides every write action without the permissions", () => {
    mocks.perms = { view: true, create: false, edit: false, delete: false };
    render(<ExternalCompaniesPage />);

    expect(screen.queryByRole("button", { name: /new company/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit agero/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete agero/i })).not.toBeInTheDocument();
    // …but the list itself is still readable.
    expect(screen.getByText("Agero")).toBeInTheDocument();
  });

  it("refuses to render for a user without view access", () => {
    mocks.perms = { view: false, create: false, edit: false, delete: false };
    render(<ExternalCompaniesPage />);

    expect(screen.getByText("No access")).toBeInTheDocument();
    expect(screen.queryByText("Agero")).not.toBeInTheDocument();
  });
});
