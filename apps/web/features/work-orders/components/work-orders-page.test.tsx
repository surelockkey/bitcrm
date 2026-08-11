import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { WorkOrdersPage } from "./work-orders-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const permissions = vi.hoisted(() => ({
  value: { can: (_r: string, _a: string): boolean => true },
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => permissions.value,
}));

function mockApi() {
  server.use(
    http.get("*/crm/work-orders", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "w1", woNumber: "WO-100", companyId: "c1", date: "2026-11-05", amount: 5000, status: "open", dealId: "deal-9", createdBy: "u1", createdAt: "", updatedAt: "" },
          { id: "w2", woNumber: "WO-200", companyId: "c2", date: "2026-11-06", status: "closed", createdBy: "u1", createdAt: "", updatedAt: "" },
        ],
      }),
    ),
    http.get("*/crm/companies", () =>
      HttpResponse.json({
        success: true,
        data: [
          { id: "c1", title: "ABC Supply", phones: [], emails: [], clientType: "commercial", status: "active", createdBy: "u1", createdAt: "", updatedAt: "" },
          { id: "c2", title: "City of Austin", phones: [], emails: [], clientType: "government", status: "active", createdBy: "u1", createdAt: "", updatedAt: "" },
        ],
        pagination: { count: 2 },
      }),
    ),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  permissions.value = { can: () => true };
  mockApi();
});

describe("WorkOrdersPage", () => {
  it("renders the registry with WO numbers and client names", async () => {
    render(<WorkOrdersPage />, { wrapper });
    expect(await screen.findByText("WO-100")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("ABC Supply")).toBeInTheDocument());
    expect(screen.getByText("WO-200")).toBeInTheDocument();
  });

  it("shows the New work order action for creators", async () => {
    render(<WorkOrdersPage />, { wrapper });
    expect(await screen.findByRole("button", { name: /new work order/i })).toBeInTheDocument();
  });

  it("blocks access without work_orders.view", async () => {
    permissions.value = { can: () => false };
    render(<WorkOrdersPage />, { wrapper });
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });
});
