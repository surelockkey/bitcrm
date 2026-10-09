import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { createTemplateContent } from "@bitcrm/document-renderer";
import { server } from "@/test/msw/server";
import { DocumentsSettingsPage } from "./documents-settings-page";

const push = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => search,
  usePathname: () => "/settings/documents",
}));

let canEdit = true;
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (_r: string, action = "view") => action === "view" || canEdit,
    me: { id: "me" },
    isLoading: false,
    isTechnician: false,
  }),
}));

const summaries = [
  { id: "inv-default", name: "Standard invoice", kind: "invoice", isDefault: true, version: 1, updatedAt: "x" },
  { id: "inv-2", name: "Commercial invoice", kind: "invoice", isDefault: false, version: 1, updatedAt: "x", autoApply: { jobTypeIds: ["jt1"] } },
  { id: "est-1", name: "Standard estimate", kind: "estimate", isDefault: true, version: 1, updatedAt: "x" },
  { id: "cus-1", name: "Service agreement", kind: "custom", isDefault: false, version: 1, updatedAt: "x" },
];

const calls: { method: string; path: string; body?: unknown }[] = [];
const ok = (data: unknown) => HttpResponse.json({ success: true, data });

beforeEach(() => {
  calls.length = 0;
  canEdit = true;
  search = new URLSearchParams();
  push.mockReset();
  replace.mockReset();
  server.use(
    http.get("*/billing/templates", () => ok(summaries)),
    http.get("*/billing/templates/:id", ({ params }) => {
      const s = summaries.find((t) => t.id === params.id)!;
      return ok({ ...s, ...createTemplateContent(s.kind as "invoice", "classic"), createdBy: "u", createdAt: "x" });
    }),
    http.post("*/billing/templates/:id/default", ({ params }) => {
      calls.push({ method: "POST", path: `default/${params.id}` });
      return ok({});
    }),
    http.post("*/billing/templates/:id/duplicate", ({ params }) => {
      calls.push({ method: "POST", path: `duplicate/${params.id}` });
      return ok({});
    }),
    http.delete("*/billing/templates/:id", ({ params }) => {
      calls.push({ method: "DELETE", path: String(params.id) });
      return ok(null);
    }),
    http.post("*/billing/templates", async ({ request }) => {
      const body = await request.json();
      calls.push({ method: "POST", path: "create", body });
      return ok({ id: "new-1", ...(body as object), isDefault: false, version: 1, ...createTemplateContent("invoice") });
    }),
    http.get("*/deals/job-types", () => ok([{ id: "jt1", name: "Rekey", priority: 0, active: true }])),
    http.get("*/deals/service-areas", () => ok([])),
    http.get("*/billing/business-profiles", () =>
      ok([{ id: "bp-default", isDefault: true, active: true, name: "SureLock", defaultPaymentTerms: "net30", dueDateBasis: "invoice_created" }]),
    ),
  );
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DocumentsSettingsPage />
    </QueryClientProvider>,
  );
}

describe("DocumentsSettingsPage — templates, as Workiz's Document templates grid", () => {
  it("lists every template in one grid: invoices, estimates, custom; the default of each first", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Document templates" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name",
      "Type",
      "Default",
      "Auto-applies to",
      "",
    ]);
    const names = within(table)
      .getAllByRole("link")
      .map((a) => a.textContent);
    expect(names).toEqual(["Standard invoice", "Commercial invoice", "Standard estimate", "Service agreement"]);
    expect(within(table).getByRole("link", { name: "Commercial invoice" })).toHaveAttribute("href", "/settings/documents/inv-2");
    const commercial = within(table).getByRole("link", { name: "Commercial invoice" }).closest("tr")!;
    expect(within(commercial).getByText("Rekey")).toBeInTheDocument();
    const standard = within(table).getByRole("link", { name: "Standard invoice" }).closest("tr")!;
    expect(within(standard).getByText("Default")).toBeInTheDocument();
    expect(within(table).getByText("Custom document")).toBeInTheDocument();
  });

  it("opens the editor from a row", async () => {
    const user = userEvent.setup();
    renderPage();
    const table = await screen.findByRole("table", { name: "Document templates" });
    await user.click(within(table).getByText("Custom document"));
    expect(push).toHaveBeenCalledWith("/settings/documents/cus-1");
  });

  it("sets a default from the row; a default has no trash and no star", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Set Commercial invoice as default" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "POST", path: "default/inv-2" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Delete Standard invoice" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set Standard invoice as default" })).not.toBeInTheDocument();
  });

  it("offers no default for custom documents, and duplicates any template", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Duplicate Service agreement" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "POST", path: "duplicate/cus-1" }));
    expect(screen.queryByRole("button", { name: "Set Service agreement as default" })).not.toBeInTheDocument();
  });

  it("deletes after confirming", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Delete Commercial invoice" }));
    await user.click(await screen.findByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "DELETE", path: "inv-2" }));
  });

  it("creates a template from a preset and opens the editor", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add New Template" }));
    const dialog = await screen.findByRole("dialog", { name: "Add New Template" });
    await user.type(within(dialog).getByLabelText("Name"), "Big jobs");
    await user.click(within(dialog).getByRole("radio", { name: /Modern/ }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "POST", path: "create", body: { name: "Big jobs", kind: "invoice", presetId: "modern" } }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/settings/documents/new-1"));
  });

  it("asks for a name before creating", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Add New Template" }));
    const dialog = await screen.findByRole("dialog", { name: "Add New Template" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(calls.find((c) => c.path === "create")).toBeUndefined();
  });

  it("hides editing actions without the edit permission", async () => {
    canEdit = false;
    renderPage();
    await screen.findByText("Standard invoice");
    expect(screen.queryByRole("button", { name: "Add New Template" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Duplicate Service agreement" })).not.toBeInTheDocument();
  });
});

describe("DocumentsSettingsPage — tabs and companies", () => {
  it("switches tabs through ?tab=", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Standard invoice");
    expect(screen.getByRole("tab", { name: "Templates" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Messages" }));
    expect(replace).toHaveBeenCalledWith("/settings/documents?tab=messages");
  });

  it("points to Settings → Companies instead of editing a business profile", async () => {
    search = new URLSearchParams("tab=profile");
    renderPage();
    await screen.findByText("Standard invoice");
    expect(screen.getByRole("link", { name: /Settings → Companies/ })).toHaveAttribute("href", "/settings/companies");
    expect(screen.queryByLabelText("Business name")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Business profile/ })).not.toBeInTheDocument();
  });
});
