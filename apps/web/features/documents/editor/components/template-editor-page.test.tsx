import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { createTemplateContent } from "@bitcrm/document-renderer";
import { TooltipProvider } from "@/components/ui/tooltip";
import { server } from "@/test/msw/server";
import { useEditorStore } from "../store";
import { TemplateEditorPage } from "./template-editor-page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/settings/documents/t1",
  useSearchParams: () => new URLSearchParams(),
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

const ok = (data: unknown) => HttpResponse.json({ success: true, data });

let version = 3;
let putStatus = 200;
const puts: Record<string, unknown>[] = [];

function template() {
  return {
    id: "t1",
    name: "Standard invoice",
    kind: "invoice",
    isDefault: true,
    version,
    createdBy: "u",
    createdAt: "x",
    updatedAt: "x",
    ...createTemplateContent("invoice", "classic"),
  };
}

let desktop = true;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  version = 3;
  putStatus = 200;
  puts.length = 0;
  canEdit = true;
  desktop = true;
  push.mockReset();
  window.matchMedia = ((query: string) => ({
    matches: query.includes("min-width: 1024px") ? desktop : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  server.use(
    http.get("*/billing/templates/t1", () => ok(template())),
    http.put("*/billing/templates/t1", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      puts.push(body);
      if (putStatus === 409) {
        return HttpResponse.json({ success: false, error: { code: "CONFLICT", message: "Version mismatch" } }, { status: 409 });
      }
      version += 1;
      return ok({ ...template(), ...body, version });
    }),
    http.get("*/billing/business-profiles", () =>
      ok([
        { id: "bp-default", name: "SureLock", isDefault: true, active: true, defaultPaymentTerms: "cash", dueDateBasis: "invoice_created" },
        { id: "bp-2", name: "KeyPro", isDefault: false, active: true, defaultPaymentTerms: "cash", dueDateBasis: "invoice_created" },
        { id: "bp-3", name: "Old Brand", isDefault: false, active: false, defaultPaymentTerms: "cash", dueDateBasis: "invoice_created" },
      ]),
    ),
    http.get("*/deals/job-types", () => ok([])),
    http.get("*/deals/service-areas", () => ok([])),
  );
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <TemplateEditorPage templateId="t1" />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const saveButton = () => screen.getByRole("button", { name: /^Save$/ });

async function loaded() {
  await screen.findByRole("button", { name: "Rename template Standard invoice" });
}

describe("TemplateEditorPage", () => {
  it("loads the template into a three-pane editor", async () => {
    renderPage();
    await loaded();
    expect(screen.getByRole("complementary", { name: "Design tools" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: "Items list block" })).toHaveLength(1);
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("inserts a block from the Tools panel and saves with the version", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    const before = screen.queryAllByRole("group", { name: "Divider block" }).length;
    await user.click(screen.getByRole("button", { name: "Add Divider block" }));
    expect(screen.getAllByRole("group", { name: "Divider block" })).toHaveLength(before + 1);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    // The new block is selected: its properties show on the right.
    expect(within(screen.getByRole("complementary", { name: "Properties" })).getByText("Divider block")).toBeInTheDocument();

    await user.click(saveButton());
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ name: "Standard invoice", version: 3, autoApply: { jobTypeIds: [], serviceAreaIds: [], businessProfileIds: [] } });
    expect(puts[0]).toHaveProperty("page");
    expect(puts[0]).toHaveProperty("visibility");
    await waitFor(() => expect(screen.getByText("All changes saved")).toBeInTheDocument());
    expect(useEditorStore.getState().version).toBe(4);
  });

  it("auto-applies by company from the Settings tab", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    await user.click(screen.getByRole("tab", { name: /Settings/ }));
    const companies = await screen.findByRole("group", { name: "Companies" });
    expect(within(companies).queryByText("Old Brand")).not.toBeInTheDocument();
    await user.click(await within(companies).findByRole("checkbox", { name: "KeyPro" }));
    await user.click(saveButton());
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ autoApply: { jobTypeIds: [], serviceAreaIds: [], businessProfileIds: ["bp-2"] } });
  });

  it("saves with Ctrl+S", async () => {
    renderPage();
    await loaded();
    act(() => void useEditorStore.getState().rename("Renamed"));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(puts[0]).toMatchObject({ name: "Renamed" }));
  });

  it("offers to reload on a version conflict", async () => {
    putStatus = 409;
    const user = userEvent.setup();
    renderPage();
    await loaded();
    act(() => void useEditorStore.getState().rename("Mine"));
    await user.click(saveButton());
    const dialog = await screen.findByRole("alertdialog", { name: /changed elsewhere/ });
    version = 9;
    await user.click(within(dialog).getByRole("button", { name: "Load latest" }));
    await waitFor(() => expect(useEditorStore.getState().version).toBe(9));
    expect(useEditorStore.getState().draft?.name).toBe("Standard invoice");
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
  });

  it("overwrites with the latest version when asked", async () => {
    putStatus = 409;
    const user = userEvent.setup();
    renderPage();
    await loaded();
    act(() => void useEditorStore.getState().rename("Mine"));
    await user.click(saveButton());
    const dialog = await screen.findByRole("alertdialog", { name: /changed elsewhere/ });
    version = 7;
    putStatus = 200;
    await user.click(within(dialog).getByRole("button", { name: "Overwrite" }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toMatchObject({ name: "Mine", version: 7 });
  });

  it("blocks saving an invalid template and lists the errors", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    act(() => {
      const s = useEditorStore.getState();
      const d = s.draft!;
      // Bypass the store's guards to simulate a broken layout.
      const body = [...d.content.body];
      body[0] = { ...body[0], columns: body[0].columns.map((c) => ({ ...c, span: 5 })) };
      useEditorStore.setState({ draft: { ...d, content: { ...d.content, body } } });
    });
    await user.click(saveButton());
    const dialog = await screen.findByRole("alertdialog", { name: /can't be saved/ });
    expect(within(dialog).getByText(/must sum to 12/)).toBeInTheDocument();
    expect(puts).toHaveLength(0);
  });

  it("deletes the selected block with Delete and restores it with Ctrl+Z", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    const items = screen.getByRole("group", { name: "Items list block" });
    await user.click(items);
    expect(items).toHaveAttribute("aria-current", "true");
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(screen.queryByRole("group", { name: "Items list block" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(screen.getByRole("group", { name: "Items list block" })).toBeInTheDocument();
  });

  it("renames inline", async () => {
    const user = userEvent.setup();
    renderPage();
    await loaded();
    await user.click(screen.getByRole("button", { name: "Rename template Standard invoice" }));
    const input = screen.getByRole("textbox", { name: "Template name" });
    await user.clear(input);
    await user.type(input, "Commercial{Enter}");
    expect(screen.getByRole("button", { name: "Rename template Commercial" })).toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
  });

  it("shows a read-only preview on narrow screens", async () => {
    desktop = false;
    renderPage();
    await loaded();
    expect(screen.getByText(/needs a larger screen/)).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Design tools" })).not.toBeInTheDocument();
    expect(await screen.findByTitle("Live preview")).toBeInTheDocument();
  });

  it("asks before leaving with unsaved changes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderPage();
    await loaded();
    act(() => void useEditorStore.getState().rename("Changed"));
    await user.click(screen.getByRole("button", { name: "Back to templates" }));
    expect(confirm).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Back to templates" }));
    expect(push).toHaveBeenCalledWith("/settings/documents");
    confirm.mockRestore();
  });
});
