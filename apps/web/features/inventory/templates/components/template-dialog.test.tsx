import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { ContainerTemplate, Product } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

type Mutate = (vars: unknown, opts?: { onSuccess?: () => void }) => void;

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  template: undefined as { isLoading: boolean; isError: boolean; data?: unknown } | undefined,
  create: vi.fn(),
  update: vi.fn(),
  searches: [] as URLSearchParams[],
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action = "view") => !mocks.denied.has(`${resource}.${action}`),
  }),
}));

const mutation = (fn: (vars: unknown) => void) => ({
  isPending: false,
  mutate: ((vars, opts) => {
    fn(vars);
    opts?.onSuccess?.();
  }) as Mutate,
});
vi.mock("../hooks", () => ({
  useContainerTemplate: () => mocks.template,
  useCreateTemplate: () => mutation(mocks.create),
  useUpdateTemplate: () => mutation(mocks.update),
}));

import { TemplateDialog } from "./template-dialog";

const product = (id: string, number: number, name: string, sku: string): Product => ({
  id,
  number,
  name,
  sku,
  category: "Locks",
  type: ProductType.PRODUCT,
  costCompany: 0,
  costTech: 0,
  priceClient: 0,
  serialTracking: false,
  minimumStockLevel: 0,
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
});

const CATALOG = [
  product("p1", 1042, "Deadbolt", "LOCK-001"),
  product("p2", 1043, "Deadlatch", "LOCK-002"),
  product("p3", 2001, "Key blank", "KEY-7"),
];

const TEMPLATE: ContainerTemplate = {
  id: "t1",
  name: "Standard van",
  description: "Every lockout van",
  items: [{ productId: "p3", productName: "Key blank", sku: "KEY-7", quantity: 50 }],
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

beforeEach(() => {
  mocks.denied = new Set();
  mocks.template = { isLoading: false, isError: false, data: TEMPLATE };
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.searches = [];
  server.use(
    http.get("*/inventory/products", ({ request }) => {
      const q = new URL(request.url).searchParams;
      mocks.searches.push(q);
      const term = (q.get("search") ?? "").toLowerCase();
      return HttpResponse.json({
        success: true,
        data: CATALOG.filter((p) => p.name.toLowerCase().includes(term)),
        pagination: {},
      });
    }),
  );
});

function open(templateId: string | null = null) {
  const onOpenChange = vi.fn();
  renderWithClient(<TemplateDialog templateId={templateId} open onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

const search = () => screen.getByRole("searchbox", { name: "Add a product" });
const lines = () =>
  [...document.querySelectorAll('[role="dialog"] [data-line]')].map((el) => ({
    id: el.getAttribute("data-line"),
    qty: (el.querySelector("input") as HTMLInputElement).value,
  }));

async function add(term: string, option: RegExp) {
  await userEvent.clear(search());
  await userEvent.type(search(), term);
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

describe("TemplateDialog — a new template", () => {
  it("asks for a name, a description and the lines", () => {
    open();
    expect(screen.getByRole("dialog", { name: "New template" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByText("No products yet — search to add the first one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("searches stock-managed items on the server, showing Product ID · name · SKU", async () => {
    open();
    await userEvent.type(search(), "dead");
    const option = await screen.findByRole("option", { name: /Deadbolt/ });
    expect(option).toHaveTextContent("1042");
    expect(option).toHaveTextContent("LOCK-001");
    const last = mocks.searches.at(-1)!;
    expect(last.get("search")).toBe("dead");
    expect(last.get("manageStock")).toBe("true");
    // Debounced: no request per keystroke.
    expect(mocks.searches.some((q) => q.get("search") === "de")).toBe(false);
  });

  // The results used to be drawn inside the popup's scrolling body: on a new
  // or short template they were cut off by it and hidden behind the footer.
  it("draws the results outside the scrolling body, so nothing clips them", async () => {
    open();
    await userEvent.type(search(), "dead");
    const option = await screen.findByRole("option", { name: /Deadbolt/ });
    expect(screen.getByTestId("template-body")).not.toContainElement(option);
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  // Each keystroke used to swap the list for "Searching…" and back.
  it("keeps the last results on screen while the next search runs", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.get("*/inventory/products", async ({ request }) => {
        const term = (new URL(request.url).searchParams.get("search") ?? "").toLowerCase();
        if (term === "deadb") await gate;
        return HttpResponse.json({
          success: true,
          data: CATALOG.filter((p) => p.name.toLowerCase().includes(term)),
          pagination: {},
        });
      }),
    );
    open();
    await userEvent.type(search(), "dead");
    await screen.findByRole("option", { name: /Deadlatch/ });

    await userEvent.type(search(), "b");
    await new Promise((r) => setTimeout(r, 350));
    expect(screen.queryByText("Searching…")).toBeNull();
    expect(screen.getByRole("option", { name: /Deadlatch/ })).toBeInTheDocument();

    release();
    await waitFor(() => expect(screen.queryByRole("option", { name: /Deadlatch/ })).toBeNull());
    expect(screen.getByRole("option", { name: /Deadbolt/ })).toBeInTheDocument();
  });

  it("keeps typing in the box while the results are open", async () => {
    open();
    await userEvent.type(search(), "dead");
    await screen.findByRole("option", { name: /Deadbolt/ });
    expect(search()).toHaveFocus();
  });

  it("adds a line at 1 and focuses its quantity", async () => {
    open();
    await add("dead", /Deadbolt/);
    expect(lines()).toEqual([{ id: "p1", qty: "1" }]);
    expect(screen.getByRole("spinbutton", { name: "Quantity of Deadbolt" })).toHaveFocus();
  });

  it("adds each product once — picking it again focuses its quantity", async () => {
    open();
    await add("dead", /Deadbolt/);
    await add("dead", /Deadlatch/);
    await add("dead", /Deadbolt/);
    expect(lines().map((l) => l.id)).toEqual(["p1", "p2"]);
    expect(screen.getByRole("spinbutton", { name: "Quantity of Deadbolt" })).toHaveFocus();
  });

  it("takes whole quantities of 1 or more", async () => {
    open();
    await userEvent.type(screen.getByLabelText("Name"), "Standard van");
    await add("dead", /Deadbolt/);
    const qty = screen.getByRole("spinbutton", { name: "Quantity of Deadbolt" });
    await userEvent.clear(qty);
    await userEvent.type(qty, "0");
    expect(screen.getByText("Enter 1 or more")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.clear(qty);
    await userEvent.type(qty, "6");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("removes a line", async () => {
    open();
    await add("dead", /Deadbolt/);
    await add("key", /Key blank/);
    await userEvent.click(screen.getByRole("button", { name: "Remove Deadbolt" }));
    expect(lines().map((l) => l.id)).toEqual(["p3"]);
  });

  it("creates it with the yellow Save, then closes", async () => {
    const { onOpenChange } = open();
    await userEvent.type(screen.getByLabelText("Name"), " Standard van ");
    await add("dead", /Deadbolt/);
    const qty = screen.getByRole("spinbutton", { name: "Quantity of Deadbolt" });
    await userEvent.clear(qty);
    await userEvent.type(qty, "4");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toHaveAttribute("data-variant", "default");
    await userEvent.click(save);
    expect(mocks.create).toHaveBeenCalledWith({
      name: "Standard van",
      items: [{ productId: "p1", quantity: 4 }],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("is closed to someone who may not create templates", () => {
    mocks.denied.add("containers.create");
    open();
    expect(screen.getByText("You don't have permission to create templates.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("TemplateDialog — editing one", () => {
  it("opens with its name, description and lines", () => {
    open("t1");
    expect(screen.getByRole("dialog", { name: "Edit template" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Standard van");
    expect(screen.getByLabelText("Description")).toHaveValue("Every lockout van");
    expect(lines()).toEqual([{ id: "p3", qty: "50" }]);
    const line = document.querySelector('[data-line="p3"]') as HTMLElement;
    expect(within(line).getByText("Key blank")).toBeInTheDocument();
    expect(within(line).getByText("KEY-7")).toBeInTheDocument();
  });

  it("saves the changes — a cleared description as null, every line", async () => {
    const { onOpenChange } = open("t1");
    await userEvent.clear(screen.getByLabelText("Description"));
    await add("dead", /Deadbolt/);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.update).toHaveBeenCalledWith({
      id: "t1",
      body: {
        name: "Standard van",
        description: null,
        items: [
          { productId: "p3", quantity: 50 },
          { productId: "p1", quantity: 1 },
        ],
      },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes without a request when nothing changed", async () => {
    const { onOpenChange } = open("t1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("is read-only without containers.edit", () => {
    mocks.denied.add("containers.edit");
    open("t1");
    expect(screen.getByRole("dialog", { name: "Template" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.queryByRole("searchbox", { name: "Add a product" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("says so for a template that can't be read", () => {
    mocks.template = { isLoading: false, isError: true };
    open("t404");
    expect(screen.getByRole("dialog", { name: "Template not found" })).toBeInTheDocument();
  });
});

describe("TemplateDialog — loading", () => {
  // Opened and then filled in, the popup grew by its footer.
  it("has its footer in place while the template loads", () => {
    mocks.template = { isLoading: true, isError: false };
    open("t1");
    expect(screen.getByTestId("template-loading")).toBeInTheDocument();
    expect(screen.getByTestId("dialog-footer-placeholder")).toBeInTheDocument();
  });
});
