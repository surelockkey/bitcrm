import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { WorkOrdersPage } from "./work-orders-page";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const permissions = vi.hoisted(() => ({
  value: { can: (() => true) as (resource: string, action: string) => boolean, isLoading: false },
}));
vi.mock("@/features/auth/use-permissions", () => ({
  // This suite asserts the refusal, so `useDenied` mirrors its own `can`.
  useDenied: () => (r: string, a = "view") => !permissions.value.can(r, a),
  usePermissions: () => permissions.value,
}));

const WOS = [
  { id: "w1", woNumber: "WO-100", companyId: "c1", date: "2026-11-05", amount: 5000, status: "open", dealId: "deal-9", description: "Rekey all doors", createdBy: "u1", createdAt: "", updatedAt: "" },
  { id: "w2", woNumber: "WO-200", companyId: "c2", date: "2026-11-06", status: "closed", createdBy: "u1", createdAt: "", updatedAt: "" },
];
const COMPANIES = [
  { id: "c1", title: "ABC Supply", phones: ["+15125550101"], emails: ["ap@abc.test"], address: "1 Main St, Austin, TX 78701", clientType: "commercial", status: "active", createdBy: "u1", createdAt: "", updatedAt: "" },
  { id: "c2", title: "City of Austin", phones: [], emails: [], clientType: "government", status: "active", createdBy: "u1", createdAt: "", updatedAt: "" },
];

const calls = vi.hoisted(() => ({ deleted: [] as string[] }));

function mockApi({ workOrders = WOS as Array<(typeof WOS)[number] & { s3Key?: string }>, documentUrl = null as string | null } = {}) {
  // A work order with a file carries its S3 key; only then is its link asked for.
  if (documentUrl) workOrders = workOrders.map((w) => (w.id === "w1" ? { ...w, s3Key: "work-orders/w1" } : w));
  server.use(
    http.get("*/crm/work-orders", () => HttpResponse.json({ success: true, data: workOrders })),
    http.get("*/crm/work-orders/:id/document", () =>
      documentUrl
        ? HttpResponse.json({ success: true, data: { downloadUrl: documentUrl } })
        : HttpResponse.json({ success: false, error: { code: "NOT_FOUND", message: "No document" } }, { status: 404 }),
    ),
    http.get("*/crm/work-orders/:id", ({ params }) => {
      const wo = workOrders.find((w) => w.id === params.id);
      return wo
        ? HttpResponse.json({ success: true, data: wo })
        : HttpResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    }),
    http.delete("*/crm/work-orders/:id", ({ params }) => {
      calls.deleted.push(String(params.id));
      return HttpResponse.json({ success: true, data: { archived: true } });
    }),
    http.get("*/crm/companies", () => HttpResponse.json({ success: true, data: COMPANIES, pagination: { count: 2 } })),
    http.get("*/crm/companies/:id", ({ params }) =>
      HttpResponse.json({ success: true, data: COMPANIES.find((c) => c.id === params.id) }),
    ),
    http.post("*/deals/by-ids", () =>
      HttpResponse.json({ success: true, data: [{ id: "deal-9", dealNumber: "PK4399", contactId: "x", stage: "new" }] }),
    ),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  permissions.value = { can: () => true, isLoading: false };
  nav.push.mockReset();
  calls.deleted = [];
  mockApi();
});

/** The list follows Workiz's list pattern (the Estimates / Invoices pages): cards, Filter results, the grey strip, the grid. */
describe("WorkOrdersPage — the list", () => {
  it("lists every work order with its client, date, amount, status and job", async () => {
    render(<WorkOrdersPage />, { wrapper });
    const grid = await screen.findByRole("table", { name: "Work orders" });
    expect(await within(grid).findByText("WO-100")).toBeInTheDocument();
    expect(within(grid).getByText("ABC Supply")).toBeInTheDocument();
    expect(within(grid).getByText("WO-200")).toBeInTheDocument();
    expect(within(grid).getByText("City of Austin")).toBeInTheDocument();
    expect(within(grid).getByText("Thu Nov 05, 2026")).toBeInTheDocument();
    expect(within(grid).getByText("$5,000.00")).toBeInTheDocument();
    expect(within(grid).getByText("Closed")).toBeInTheDocument();
    expect(within(grid).getByRole("link", { name: "PK4399" })).toHaveAttribute("href", "/deals/deal-9");
  });

  it("puts the status cards over it — the status big over 'N Worth $X'", async () => {
    render(<WorkOrdersPage />, { wrapper });
    expect(await screen.findByRole("button", { name: "1 Worth $5,000.00 Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 Worth $0.00 Closed" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0 Worth $0.00 Archived" })).toBeInTheDocument();
  });

  it("a card is the status filter: Closed leaves the closed one and a 'status: Closed' chip", async () => {
    render(<WorkOrdersPage />, { wrapper });
    const card = await screen.findByRole("button", { name: "1 Worth $0.00 Closed" });
    await userEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
    const grid = screen.getByRole("table", { name: "Work orders" });
    expect(within(grid).queryByText("WO-100")).not.toBeInTheDocument();
    expect(within(grid).getByText("WO-200")).toBeInTheDocument();
    expect(screen.getByText("status: Closed")).toBeInTheDocument();
  });

  it("Search finds a work order by its number, client or description", async () => {
    render(<WorkOrdersPage />, { wrapper });
    const grid = await screen.findByRole("table", { name: "Work orders" });
    await within(grid).findByText("WO-100");
    const search = screen.getByRole("textbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "austin" } });
    expect(within(grid).queryByText("WO-100")).not.toBeInTheDocument();
    expect(within(grid).getByText("WO-200")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "rekey" } });
    expect(within(grid).getByText("WO-100")).toBeInTheDocument();
    expect(within(grid).queryByText("WO-200")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });

  it("a row opens that work order's own view", async () => {
    render(<WorkOrdersPage />, { wrapper });
    const grid = await screen.findByRole("table", { name: "Work orders" });
    await userEvent.click(await within(grid).findByText("City of Austin"));
    expect(nav.push).toHaveBeenCalledWith("/work-orders?id=w2");
  });

  it("says No Records Found when there are none", async () => {
    mockApi({ workOrders: [] });
    render(<WorkOrdersPage />, { wrapper });
    expect(await screen.findByText("No Records Found")).toBeInTheDocument();
  });

  it("offers + Add New to creators only", async () => {
    render(<WorkOrdersPage />, { wrapper });
    expect(await screen.findByRole("button", { name: /add new/i })).toBeInTheDocument();
  });

  it("hides + Add New without work_orders.create, and the job link without deals.view", async () => {
    permissions.value = { can: (r, a) => !(r === "work_orders" && a === "create") && r !== "deals", isLoading: false };
    render(<WorkOrdersPage />, { wrapper });
    const grid = await screen.findByRole("table", { name: "Work orders" });
    await within(grid).findByText("WO-100");
    expect(screen.queryByRole("button", { name: /add new/i })).not.toBeInTheDocument();
    expect(within(grid).queryByRole("link", { name: "PK4399" })).not.toBeInTheDocument();
  });

  it("blocks access without work_orders.view", async () => {
    permissions.value = { can: () => false, isLoading: false };
    render(<WorkOrdersPage />, { wrapper });
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });

  it("puts a drag handle on every column (react-table's resizable headers)", async () => {
    render(<WorkOrdersPage />, { wrapper });
    await screen.findByRole("table", { name: "Work orders" });
    for (const id of ["woNumber", "client", "date", "amount", "status", "job", "description"]) {
      expect(screen.getByTestId(`resize-${id}`)).toBeInTheDocument();
    }
  });
});

/** `?id=` — a job's Actions → View Work Order: Workiz's work order page. */
describe("WorkOrdersPage — one work order", () => {
  it("shows Workiz's header and the work order paper", async () => {
    render(<WorkOrdersPage initialId="w1" />, { wrapper });
    expect(await screen.findByRole("heading", { name: "Work Order #WO-100" })).toBeInTheDocument();
    expect(screen.getByText("Client:").parentElement).toHaveTextContent("Client: ABC Supply");
    const paper = screen.getByRole("article", { name: "Work order WO-100" });
    expect(within(paper).getByText("WORK ORDER")).toBeInTheDocument();
    expect(within(paper).getByText("Order NO.")).toBeInTheDocument();
    expect(within(paper).getByText("Thu Nov 05, 2026")).toBeInTheDocument();
    expect(within(paper).getByText("PK4399")).toBeInTheDocument();
    expect(within(paper).getByText("Client Details:")).toBeInTheDocument();
    expect(within(paper).getByText("1 Main St, Austin, TX 78701")).toBeInTheDocument();
    expect(within(paper).getByText("Rekey all doors")).toBeInTheDocument();
    expect(within(paper).getAllByText("5,000.00").length).toBeGreaterThan(0);
    // Not the list.
    expect(screen.queryByRole("table", { name: "Work orders" })).not.toBeInTheDocument();
  });

  it("frames the uploaded document when there is one", async () => {
    mockApi({ documentUrl: "https://s3.test/wo.pdf" });
    render(<WorkOrdersPage initialId="w1" />, { wrapper });
    const frame = await screen.findByTitle("Work order WO-100 document");
    expect(frame).toHaveAttribute("src", "https://s3.test/wo.pdf");
  });

  it("Actions: View Job, Download (with a document), Upload file, Delete", async () => {
    mockApi({ documentUrl: "https://s3.test/wo.pdf" });
    render(<WorkOrdersPage initialId="w1" />, { wrapper });
    await screen.findByRole("heading", { name: "Work Order #WO-100" });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["View Job", "Download", "Upload file", "Delete"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "View Job" }));
    expect(nav.push).toHaveBeenCalledWith("/deals/deal-9");
  });

  it("Actions without a document, a job or the rights: only what applies", async () => {
    permissions.value = { can: (r, a) => r === "work_orders" && a === "view", isLoading: false };
    render(<WorkOrdersPage initialId="w2" />, { wrapper });
    await screen.findByRole("heading", { name: "Work Order #WO-200" });
    expect(screen.queryByRole("button", { name: "Actions" })).not.toBeInTheDocument();
  });

  it("Delete removes it and goes back to the list", async () => {
    render(<WorkOrdersPage initialId="w1" />, { wrapper });
    await screen.findByRole("heading", { name: "Work Order #WO-100" });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.deleted).toEqual(["w1"]));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/work-orders"));
  });

  it("says so when the work order does not exist", async () => {
    render(<WorkOrdersPage initialId="nope" />, { wrapper });
    expect(await screen.findByText("Work order not found")).toBeInTheDocument();
  });

  it("blocks access without work_orders.view", async () => {
    permissions.value = { can: () => false, isLoading: false };
    render(<WorkOrdersPage initialId="w1" />, { wrapper });
    expect(await screen.findByText("No access")).toBeInTheDocument();
  });
});
