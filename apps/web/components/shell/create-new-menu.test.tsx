import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarProvider } from "@/components/ui/sidebar";
import { CreateNewMenu } from "./create-new-menu";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/deals",
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const permissionsMock = vi.fn();
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => permissionsMock(),
}));

// The dialogs' bodies are their own pages' business; here only that they open.
const contactForm = vi.fn();
vi.mock("@/features/clients/components/contact-form", () => ({
  ContactForm: (props: { onDone: (c: { id: string }) => void; onCancel: () => void }) => {
    contactForm(props);
    return (
      <button type="button" onClick={() => props.onDone({ id: "c9" })}>
        save client
      </button>
    );
  },
}));
const estimateDialog = vi.fn();
vi.mock("@/features/estimates/components/new-client-estimate-dialog", () => ({
  NewClientEstimateDialog: (props: { open: boolean }) => {
    estimateDialog(props);
    return props.open ? <div data-testid="estimate-dialog" /> : null;
  },
}));

function renderMenu() {
  return render(
    <SidebarProvider>
      <CreateNewMenu />
    </SidebarProvider>,
  );
}

const can = (...allowed: string[]) => (resource: string, action = "view") =>
  action !== "create" || allowed.includes(resource);

beforeEach(() => {
  push.mockClear();
  contactForm.mockClear();
  estimateDialog.mockClear();
});

/**
 * Workiz's "Create new" (shell_fix_wz_create_new_menu): the row opens a
 * 200px menu — Lead, Job, Client | Estimate, Invoice | Add to sub-account,
 * Event — rather than going straight to a new job. Ours lists what we can
 * create from anywhere: a job, a client, a client's estimate; each only for
 * a reader allowed to create it.
 */
describe("CreateNewMenu", () => {
  it("is Workiz's row: the yellow plus disc and the words, which collapse without a jump", () => {
    permissionsMock.mockReturnValue({ can: can("deals", "contacts", "estimates") });
    renderMenu();

    const trigger = screen.getByRole("button", { name: /create new/i });
    // At rest a plain white full-width row: no border, no fill; the yellow
    // lives in the round dot. Hover turns the row into a bordered oval.
    expect(trigger.className).toContain("border-transparent");
    expect(trigger.className).not.toContain("bg-primary");
    expect(trigger.className).toContain("hover:rounded-full");
    expect(trigger.className).toContain("hover:border-border");
    const dot = trigger.querySelector("[data-slot='create-new-dot']");
    expect(dot?.className).toContain("rounded-full");
    expect(dot?.className).toContain("bg-primary");
    // Workiz's words: 13px/19px 600 with the page's 0.4px tracking, 40px row.
    expect(trigger.className).toContain("h-10");
    expect(trigger.className).toContain("tracking-[0.4px]");
    expect(trigger.className).not.toContain("tracking-[0.2px]");
    // Expanded: the row spans the rail; collapsed: it narrows via animatable
    // props, the dot keeps its left edge (same padding in both states, no
    // justify-center swap), the words fade instead of popping out.
    expect(trigger.className).toContain("w-full");
    expect(trigger.className).toContain("group-data-[collapsible=icon]:w-9");
    expect(trigger.className).toContain("transition-[width,border-radius]");
    expect(trigger.className).toContain("justify-start");
    expect(trigger.className).toContain("overflow-hidden");
    expect(trigger.className).not.toMatch(/group-data-\[collapsible=icon\]:(p|px|pl)-/);
    expect(screen.getByText("Create new").className).toContain("group-data-[collapsible=icon]:opacity-0");
  });

  it("opens Workiz's list — Job, Client | Estimate — for a reader who may create them all", async () => {
    permissionsMock.mockReturnValue({ can: can("deals", "contacts", "estimates") });
    renderMenu();

    await userEvent.click(screen.getByRole("button", { name: /create new/i }));

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.trim())).toEqual(["Job", "Client", "Estimate"]);
    // Job is a page of its own; the other two are dialogs over this page.
    expect(screen.getByRole("menuitem", { name: "Job" }).closest("a")).toHaveAttribute("href", "/deals/new");
    // Workiz rules its groups apart: one rule between the records and the documents.
    expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(1);
  });

  it("offers only what the reader may create, and nothing at all when that is nothing", async () => {
    permissionsMock.mockReturnValue({ can: can("deals") });
    const { unmount } = renderMenu();
    await userEvent.click(screen.getByRole("button", { name: /create new/i }));
    expect((await screen.findAllByRole("menuitem")).map((i) => i.textContent?.trim())).toEqual(["Job"]);
    expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(0);
    unmount();

    permissionsMock.mockReturnValue({ can: can() });
    renderMenu();
    expect(screen.queryByRole("button", { name: /create new/i })).not.toBeInTheDocument();
  });

  it("'Client' opens the Add Client dialog and lands on the new client", async () => {
    permissionsMock.mockReturnValue({ can: can("contacts") });
    renderMenu();

    await userEvent.click(screen.getByRole("button", { name: /create new/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Client" }));

    expect(await screen.findByRole("dialog", { name: "Add Client" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "save client" }));
    expect(push).toHaveBeenCalledWith("/contacts/c9");
    expect(screen.queryByRole("dialog", { name: "Add Client" })).not.toBeInTheDocument();
  });

  it("'Estimate' opens the client-estimate dialog", async () => {
    permissionsMock.mockReturnValue({ can: can("estimates") });
    renderMenu();
    expect(screen.queryByTestId("estimate-dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /create new/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Estimate" }));

    expect(await screen.findByTestId("estimate-dialog")).toBeInTheDocument();
  });
});
