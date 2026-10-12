import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { CustomFieldDefinition } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { CustomFieldsPage } from "./custom-fields-page";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, prefetch: vi.fn() }),
  usePathname: () => "/settings/custom-fields",
  useSearchParams: () => new URLSearchParams(nav.search),
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
  nav.search = "";
  nav.replace.mockReset();
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

/** Workiz's two tabs over the table: Job/Lead (the job fields) and Client. */
describe("CustomFieldsPage — Job/Lead · Client tabs", () => {
  beforeEach(() => {
    mockApi([
      field({ id: "cf-1", name: "Lock Brand", type: "dropdown", group: "Hardware" }),
      field({ id: "cf-v", name: "Vendor Number 1", group: "Work Order", entityType: "client" }),
      field({ id: "cf-p", name: "Platinum", group: "Platinum Info", entityType: "client" }),
    ]);
  });

  it("opens on Job/Lead with the job fields only", async () => {
    render(<CustomFieldsPage />, { wrapper });
    const jobTab = await screen.findByRole("tab", { name: "Job/Lead" });
    expect(jobTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Lock Brand")).toBeInTheDocument();
    expect(screen.queryByText("Vendor Number 1")).not.toBeInTheDocument();
  });

  it("the Client tab lists the client fields, with no Job Type or Required column", async () => {
    nav.search = "tab=client";
    render(<CustomFieldsPage />, { wrapper });
    expect(await screen.findByRole("tab", { name: "Client" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Vendor Number 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Group: Work Order" })).toBeInTheDocument();
    expect(screen.queryByText("Lock Brand")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Client custom fields" });
    expect(within(table).queryByRole("columnheader", { name: /job type/i })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /required/i })).not.toBeInTheDocument();
  });

  it("switching tabs keeps the tab in the address (?tab=client)", async () => {
    render(<CustomFieldsPage />, { wrapper });
    await userEvent.click(await screen.findByRole("tab", { name: "Client" }));
    expect(nav.replace).toHaveBeenCalledWith("/settings/custom-fields?tab=client", { scroll: false });
  });

  it("Add New on the Client tab adds a client field", async () => {
    nav.search = "tab=client";
    render(<CustomFieldsPage />, { wrapper });
    await userEvent.click(await screen.findByRole("button", { name: "Add New" }));
    expect(await screen.findByText("Add New Field")).toBeInTheDocument();
    expect(screen.queryByText("All Job Types")).not.toBeInTheDocument();
  });
});

/**
 * B10 — Workiz orders a group's fields by dragging its rows; the keyboard
 * moves a row with the arrow keys on its handle. Either way the moved rows'
 * priorities are written.
 */
describe("CustomFieldsPage — ordering the rows", () => {
  const puts: Array<{ id: string; body: unknown }> = [];

  beforeEach(() => {
    puts.length = 0;
    // The server keeps what it is told, so the refetch after the writes
    // answers the new order.
    const rows = [
      field({ id: "a", name: "Alpha", group: "Hardware", priority: 2 }),
      field({ id: "b", name: "Beta", group: "Hardware", priority: 1 }),
      field({ id: "c", name: "Gamma", group: "Access", priority: 0 }),
    ];
    mockApi(rows);
    server.use(
      http.get("*/deals/custom-fields", () => HttpResponse.json({ success: true, data: rows })),
      http.put("*/deals/custom-fields/:id", async ({ params, request }) => {
        const body = (await request.json()) as { priority: number };
        puts.push({ id: String(params.id), body });
        const row = rows.find((r) => r.id === params.id);
        if (row) row.priority = body.priority;
        return HttpResponse.json({ success: true, data: row });
      }),
    );
  });

  it("gives every row a drag handle you can also work with the arrow keys", async () => {
    render(<CustomFieldsPage />, { wrapper });
    const handle = await screen.findByRole("button", { name: "Move Beta" });
    expect(handle).toHaveAccessibleDescription(/arrow/i);
  });

  it("ArrowUp moves a row above the one before it and writes both priorities", async () => {
    render(<CustomFieldsPage />, { wrapper });
    const handle = await screen.findByRole("button", { name: "Move Beta" });
    handle.focus();
    await userEvent.keyboard("{ArrowUp}");

    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts).toEqual(
      expect.arrayContaining([
        { id: "b", body: { priority: 2 } },
        { id: "a", body: { priority: 1 } },
      ]),
    );
    const rows = screen.getAllByRole("button", { name: /^Edit (Alpha|Beta)$/ }).map((b) => b.textContent);
    expect(rows).toEqual(["Beta", "Alpha"]);
    // Said aloud: a polite live region beside the table.
    expect(screen.getByText("Beta moved to position 1 of 2 in Hardware")).toHaveAttribute("aria-live", "polite");
  });

  it("does nothing past the top of a group", async () => {
    render(<CustomFieldsPage />, { wrapper });
    const handle = await screen.findByRole("button", { name: "Move Alpha" });
    handle.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(puts).toHaveLength(0);
  });

  it("offers no handle to whoever cannot edit", async () => {
    permissions.value = { can: (_r?: string, action?: string) => action !== "edit" } as never;
    render(<CustomFieldsPage />, { wrapper });
    await screen.findByText("Alpha");
    expect(screen.queryByRole("button", { name: "Move Alpha" })).not.toBeInTheDocument();
  });
});
