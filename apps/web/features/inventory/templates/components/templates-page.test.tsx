import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate } from "@bitcrm/types";
import type { StockLocation } from "@/features/inventory/stock/lib";
import { renderWithClient } from "@/test/render-with-client";

const mocks = vi.hoisted(() => ({
  denied: new Set<string>(),
  templates: [] as ContainerTemplate[],
  statuses: [] as string[],
  locations: [] as StockLocation[],
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  permsLoading: false,
  templatesLoading: false,
  locationsLoading: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: vi.fn() }),
  useSearchParams: () => mocks.params,
  usePathname: () => "/inventory/templates",
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => (resource: string, action = "view") =>
    !mocks.permsLoading && mocks.denied.has(`${resource}.${action}`),
  usePermissions: () => ({
    can: (resource: string, action = "view") =>
      !mocks.permsLoading && !mocks.denied.has(`${resource}.${action}`),
    isLoading: mocks.permsLoading,
  }),
}));
vi.mock("../hooks", () => ({
  useContainerTemplates: (status: string) => {
    mocks.statuses.push(status);
    return {
      data: mocks.templatesLoading ? undefined : mocks.templates,
      isLoading: mocks.templatesLoading,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useArchiveTemplate: () => ({ mutate: vi.fn(), isPending: false }),
  useRestoreTemplate: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/inventory/stock/hooks", () => ({
  useAllLocations: () => ({
    data: mocks.locationsLoading ? [] : mocks.locations,
    isLoading: mocks.locationsLoading,
    isError: false,
  }),
}));
// The popups have suites of their own; here only what the URL opens matters.
vi.mock("./template-dialog", () => ({
  TemplateDialog: (props: { templateId: string | null; open: boolean }) =>
    props.open ? <div data-testid="template-popup" data-id={props.templateId ?? "new"} /> : null,
}));
vi.mock("./apply-template-dialog", () => ({
  ApplyTemplateDialog: (props: {
    templateId: string;
    containerId: string | null;
    open: boolean;
    onContainerChange?: (id: string) => void;
  }) =>
    props.open ? (
      <div data-testid="apply-popup" data-id={props.templateId} data-container={props.containerId ?? ""}>
        <button onClick={() => props.onContainerChange?.("c2")}>pick van 2</button>
      </div>
    ) : null,
}));

import { TemplatesPage } from "./templates-page";

const tpl = (id: string, name: string, over: Partial<ContainerTemplate> = {}): ContainerTemplate => ({
  id,
  name,
  items: [{ productId: "p1", productName: "Deadbolt", sku: "L", quantity: 4 }],
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const van = (id: string, templateId?: string): StockLocation => ({
  type: "container",
  id,
  name: id,
  status: InventoryStatus.ACTIVE,
  templateId,
});

beforeEach(() => {
  mocks.denied = new Set();
  mocks.templates = [tpl("t1", "Standard van"), tpl("t2", "Lockout van")];
  mocks.statuses = [];
  mocks.locations = [van("c1", "t1"), van("c2", "t1"), van("c3", "t2"), van("c4")];
  mocks.params = new URLSearchParams();
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.permsLoading = false;
  mocks.templatesLoading = false;
  mocks.locationsLoading = false;
});

const noScroll = { scroll: false };

describe("TemplatesPage", () => {
  // A new search holds the area the rows are drawn in, so the pager under it
  // does not jump up into view (see ListBody).
  it("draws its rows in the list's held area, with the pager under it", () => {
    renderWithClient(<TemplatesPage />);
    const area = document.querySelector("[data-slot=list-area]");
    expect(area).toContainElement(screen.getByRole("table"));
    expect(area).not.toContainElement(screen.getByTestId("list-pagination"));
  });

  it("lists the active templates with how many vans use each", () => {
    renderWithClient(<TemplatesPage />);
    expect(mocks.statuses.at(-1)).toBe(InventoryStatus.ACTIVE);
    const row = screen.getByText("Standard van").closest("tr") as HTMLElement;
    expect(row.querySelectorAll("td")[4]).toHaveTextContent("2");
    const other = screen.getByText("Lockout van").closest("tr") as HTMLElement;
    expect(other.querySelectorAll("td")[4]).toHaveTextContent("1");
  });

  it("asks the server for the archived ones", async () => {
    renderWithClient(<TemplatesPage />);
    await userEvent.click(screen.getByRole("combobox", { name: "Status" }));
    await userEvent.click(await screen.findByRole("option", { name: "Archived" }));
    expect(mocks.statuses.at(-1)).toBe(InventoryStatus.ARCHIVED);
  });

  it("opens New template from the yellow button, in the URL", async () => {
    renderWithClient(<TemplatesPage />);
    const button = screen.getByRole("button", { name: "New template" });
    expect(button).toHaveAttribute("data-variant", "default");
    await userEvent.click(button);
    expect(mocks.push).toHaveBeenCalledWith("/inventory/templates?template=new", noScroll);
  });

  it("offers no New template without containers.create", () => {
    mocks.denied.add("containers.create");
    renderWithClient(<TemplatesPage />);
    expect(screen.queryByRole("button", { name: "New template" })).toBeNull();
  });

  it("opens a template from its row and Apply from its button", async () => {
    renderWithClient(<TemplatesPage />);
    await userEvent.click(screen.getByText("Lockout van"));
    expect(mocks.push).toHaveBeenLastCalledWith("/inventory/templates?template=t2", noScroll);
    await userEvent.click(screen.getByRole("button", { name: "Apply Standard van" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/inventory/templates?apply=t1", noScroll);
  });

  it("says so when there are none", () => {
    mocks.templates = [];
    renderWithClient(<TemplatesPage />);
    expect(screen.getByText("No templates yet")).toBeInTheDocument();
  });

  it("is closed without containers.view", () => {
    mocks.denied.add("containers.view");
    renderWithClient(<TemplatesPage />);
    expect(screen.getByText("No access")).toBeInTheDocument();
  });
});

describe("TemplatesPage — popups from the URL", () => {
  it("opens a new template from ?template=new", () => {
    mocks.params = new URLSearchParams("template=new");
    renderWithClient(<TemplatesPage />);
    expect(screen.getByTestId("template-popup")).toHaveAttribute("data-id", "new");
  });

  it("opens one template from ?template=<id>", () => {
    mocks.params = new URLSearchParams("template=t2");
    renderWithClient(<TemplatesPage />);
    expect(screen.getByTestId("template-popup")).toHaveAttribute("data-id", "t2");
  });

  it("opens Apply for a template and a van, and keeps the van in the URL", async () => {
    mocks.params = new URLSearchParams("apply=t1&container=c3");
    renderWithClient(<TemplatesPage />);
    const popup = screen.getByTestId("apply-popup");
    expect(popup).toHaveAttribute("data-id", "t1");
    expect(popup).toHaveAttribute("data-container", "c3");
    await userEvent.click(screen.getByText("pick van 2"));
    expect(mocks.replace).toHaveBeenCalledWith("/inventory/templates?apply=t1&container=c2", noScroll);
  });
});

describe("TemplatesPage — nothing jumps, and it pages", () => {
  it("draws the real table while the templates load, with the pager's space held", () => {
    mocks.templatesLoading = true;
    renderWithClient(<TemplatesPage />);
    expect([...document.querySelectorAll("thead th")].map((th) => th.textContent)).toContain("Used by");
    expect(screen.getAllByTestId("skeleton-row").length).toBeGreaterThan(0);
    expect(screen.getByTestId("list-pagination")).toHaveAttribute("aria-busy", "true");
  });

  it("never flashes No access while permissions are still loading", () => {
    mocks.permsLoading = true;
    renderWithClient(<TemplatesPage />);
    expect(screen.queryByText("No access")).toBeNull();
    expect(screen.getByRole("button", { name: "New template" })).toBeDisabled();
  });

  // "Used by" counted 0 until the whole fleet arrived, then changed.
  it("lets Used by wait for the fleet instead of printing a 0 that changes", () => {
    mocks.locationsLoading = true;
    renderWithClient(<TemplatesPage />);
    const row = screen.getByText("Standard van").closest("tr") as HTMLElement;
    const cell = row.querySelectorAll("td")[4];
    expect(cell).not.toHaveTextContent("0");
    expect(cell.querySelector("[data-testid=used-by-pending]")).not.toBeNull();
  });

  it("pages a long list instead of drawing it whole", () => {
    mocks.templates = Array.from({ length: 60 }, (_, i) => tpl(`t${i}`, `Template ${i}`));
    renderWithClient(<TemplatesPage />);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(screen.getByText("Showing 1–50 of 60")).toBeInTheDocument();
  });
});
