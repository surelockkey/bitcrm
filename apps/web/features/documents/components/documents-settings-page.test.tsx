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

describe("DocumentsSettingsPage — templates", () => {
  it("groups templates by kind with default badges and auto-apply summaries", async () => {
    renderPage();
    const invoices = await screen.findByRole("region", { name: "Invoices" });
    expect(within(invoices).getByText("Standard invoice")).toBeInTheDocument();
    expect(within(invoices).getByText("Default")).toBeInTheDocument();
    expect(await within(invoices).findByText("Auto-applies to Rekey")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Estimates" })).getByText("Standard estimate")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Custom documents" })).getByText("Service agreement")).toBeInTheDocument();
  });

  it("sets a default and disables delete for defaults", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Actions for Commercial invoice" }));
    await user.click(await screen.findByRole("menuitem", { name: /Set as default/ }));
    await waitFor(() => expect(calls).toContainEqual({ method: "POST", path: "default/inv-2" }));

    await user.click(screen.getByRole("button", { name: "Actions for Standard invoice" }));
    expect(await screen.findByRole("menuitem", { name: /Delete/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menuitem", { name: /Set as default/ })).not.toBeInTheDocument();
  });

  it("offers no default option for custom documents", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Actions for Service agreement" }));
    expect(await screen.findByRole("menuitem", { name: /Duplicate/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Set as default/ })).not.toBeInTheDocument();
  });

  it("deletes after confirming", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Actions for Commercial invoice" }));
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await user.click(await screen.findByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(calls).toContainEqual({ method: "DELETE", path: "inv-2" }));
  });

  it("creates a template from a preset and opens the editor", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /New template/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Big jobs");
    await user.click(within(dialog).getByRole("radio", { name: /Modern/ }));
    await user.click(within(dialog).getByRole("button", { name: "Create template" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "POST", path: "create", body: { name: "Big jobs", kind: "invoice", presetId: "modern" } }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/settings/documents/new-1"));
  });

  it("hides editing actions without the edit permission", async () => {
    canEdit = false;
    renderPage();
    await screen.findByText("Standard invoice");
    expect(screen.queryByRole("button", { name: /New template/ })).not.toBeInTheDocument();
  });
});

describe("DocumentsSettingsPage — companies", () => {
  it("points to Settings → Companies instead of editing a business profile", async () => {
    search = new URLSearchParams("tab=profile");
    renderPage();
    await screen.findByText("Standard invoice");
    expect(screen.getByRole("link", { name: /Settings → Companies/ })).toHaveAttribute("href", "/settings/companies");
    expect(screen.queryByLabelText("Business name")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Business profile/ })).not.toBeInTheDocument();
  });
});
