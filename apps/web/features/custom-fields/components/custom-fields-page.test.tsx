import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { CustomFieldDefinition } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { CustomFieldsPage } from "./custom-fields-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const permissions = vi.hoisted(() => ({
  value: { can: (): boolean => true },
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => permissions.value,
}));

function field(over: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "cf-1",
    name: "Field",
    type: "text",
    group: "General",
    options: [],
    jobTypeIds: [],
    required: false,
    requiredToClose: false,
    searchable: false,
    priority: 0,
    active: true,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function mockApi(fields: CustomFieldDefinition[]) {
  server.use(
    http.get("*/deals/custom-fields", () =>
      HttpResponse.json({ success: true, data: fields }),
    ),
    http.get("*/deals/job-types", () =>
      HttpResponse.json({ success: true, data: [] }),
    ),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  permissions.value = { can: () => true };
  mockApi([
    field({ id: "cf-1", name: "Lock Brand", type: "dropdown", group: "Hardware" }),
    field({ id: "cf-2", name: "Access Notes", type: "large_text", group: "Access" }),
    field({ id: "cf-3", name: "Cylinder", type: "text", group: "Hardware" }),
  ]);
});

describe("CustomFieldsPage", () => {
  it("lists fields under Workiz's \"Group: …\" rows, each with its job types, type and Required", async () => {
    render(<CustomFieldsPage />, { wrapper });

    const hardware = await screen.findByRole("button", { name: "Group: Hardware" });
    expect(hardware).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Group: Access" })).toBeInTheDocument();

    const row = (await screen.findByText("Lock Brand")).closest("tr")!;
    expect(within(row).getByText("All Types")).toBeInTheDocument();
    expect(within(row).getByText("drop down")).toBeInTheDocument();
    expect(within(row).getByText("No")).toBeInTheDocument();
    expect(screen.getByText("Cylinder")).toBeInTheDocument();
    expect(screen.getByText("Access Notes")).toBeInTheDocument();
  });

  it("folds a group away and back", async () => {
    render(<CustomFieldsPage />, { wrapper });
    const hardware = await screen.findByRole("button", { name: "Group: Hardware" });
    await userEvent.click(hardware);
    expect(hardware).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Lock Brand")).not.toBeInTheDocument();
    expect(screen.getByText("Access Notes")).toBeInTheDocument();
    await userEvent.click(hardware);
    expect(screen.getByText("Lock Brand")).toBeInTheDocument();
  });

  it("blocks access without custom_fields.view", async () => {
    permissions.value = { can: () => false };
    render(<CustomFieldsPage />, { wrapper });
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });

  it("shows Workiz's Add New for creators", async () => {
    render(<CustomFieldsPage />, { wrapper });
    expect(await screen.findByRole("button", { name: "Add New" })).toBeInTheDocument();
  });
});
