import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  it("lists fields grouped under their group heading", async () => {
    render(<CustomFieldsPage />, { wrapper });

    const hardware = await screen.findByRole("heading", { name: "Hardware" });
    const access = screen.getByRole("heading", { name: "Access" });
    expect(hardware).toBeInTheDocument();
    expect(access).toBeInTheDocument();

    expect(await screen.findByText("Lock Brand")).toBeInTheDocument();
    expect(screen.getByText("Cylinder")).toBeInTheDocument();
    expect(screen.getByText("Access Notes")).toBeInTheDocument();
  });

  it("blocks access without custom_fields.view", async () => {
    permissions.value = { can: () => false };
    render(<CustomFieldsPage />, { wrapper });
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });

  it("shows the New custom field action for creators", async () => {
    render(<CustomFieldsPage />, { wrapper });
    expect(await screen.findByRole("button", { name: /new custom field/i })).toBeInTheDocument();
  });
});
