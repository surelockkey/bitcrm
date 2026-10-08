import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { JobTag } from "@bitcrm/types";

const { createMutate, updateMutate, deleteMutate, canMock, catalog } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  canMock: vi.fn(),
  catalog: { loading: false, tags: undefined as JobTag[] | undefined },
}));

const makeTag = (over: Partial<JobTag>): JobTag => ({
  id: "t1",
  name: "Rush",
  color: "red",
  priority: 0,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

// Zebra is newest but last alphabetically, so every sort order is distinguishable.
vi.mock("../hooks", () => ({
  useJobTags: () =>
    catalog.loading
      ? { data: undefined, isLoading: true }
      : {
          data: catalog.tags ?? [
            makeTag({ id: "t-zebra", name: "Zebra", color: "green", createdAt: "2026-06-01T00:00:00Z" }),
            makeTag({ id: "t-alpha", name: "Alpha", color: "blue", createdAt: "2026-01-01T00:00:00Z" }),
          ],
          isLoading: false,
        },
  useCreateJobTag: () => ({ mutate: createMutate, isPending: false }),
  useUpdateJobTag: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteJobTag: () => ({ mutate: deleteMutate, isPending: false }),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: canMock }),
}));

// Radix portal/animation wrappers; render children directly (same pattern as
// deal-quick-view.test.tsx does for the Sheet).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: React.MouseEventHandler }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

import { JobTagCombobox } from "./job-tag-combobox";

const openPicker = () => fireEvent.click(screen.getByRole("button", { name: /add tag/i }));

describe("JobTagCombobox — Workiz-style tag window", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    deleteMutate.mockReset();
    canMock.mockReset();
    canMock.mockReturnValue(true);
    catalog.loading = false;
    catalog.tags = undefined;
  });

  it("shows a skeleton pill instead of the raw id while the catalog loads", () => {
    catalog.loading = true;
    const { container } = render(<JobTagCombobox value={["t-zebra"]} onChange={vi.fn()} />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("t-zebra")).not.toBeInTheDocument();
  });

  it("shows the available-tag count in the header", () => {
    render(<JobTagCombobox value={[]} onChange={vi.fn()} />);
    openPicker();

    expect(screen.getByText("Available tags (2)")).toBeInTheDocument();
  });

  it("creates a tag via Create new, prefilled with the search query, and selects it", () => {
    createMutate.mockImplementation((body: { name: string }, opts?: { onSuccess?: (t: JobTag) => void }) => {
      opts?.onSuccess?.(makeTag({ id: "t-new", name: body.name, color: "slate" }));
    });
    const onChange = vi.fn();

    render(<JobTagCombobox value={[]} onChange={onChange} />);
    openPicker();
    fireEvent.change(screen.getByPlaceholderText("Search tags…"), { target: { value: "Emergency" } });
    fireEvent.click(screen.getByRole("button", { name: /create new/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("Emergency")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Emergency" }),
      expect.anything(),
    );
    expect(onChange).toHaveBeenCalledWith(["t-new"]);
  });

  it("edits a tag from its row without touching the job's selection", () => {
    const onChange = vi.fn();
    render(<JobTagCombobox value={[]} onChange={onChange} />);
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: "Edit Zebra" }));

    const dialog = screen.getByRole("dialog");
    const nameInput = within(dialog).getByDisplayValue("Zebra");
    fireEvent.change(nameInput, { target: { value: "Zulu" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Zulu" }),
      expect.anything(),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("deletes a tag from its row after a confirmation", () => {
    render(<JobTagCombobox value={[]} onChange={vi.fn()} />);
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: "Delete Zebra" }));
    expect(deleteMutate).not.toHaveBeenCalled();

    const confirm = screen.getByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(deleteMutate).toHaveBeenCalledWith("t-zebra");
  });

  it("sorts newest-first by default and offers A-Z, Z-A, newest and oldest", () => {
    render(<JobTagCombobox value={[]} onChange={vi.fn()} />);
    openPicker();

    const names = () =>
      screen.getAllByRole("option").map((o) => o.textContent?.replace(/Edit|Delete/g, "").trim());
    const pick = (label: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Sort by" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: label }));
    };

    // Workiz default: newest first (Zebra was created last).
    expect(names()).toEqual(["Zebra", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by" }));
    expect(screen.getByRole("menuitemradio", { name: "Newest first" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "A-Z" }));

    expect(names()).toEqual(["Alpha", "Zebra"]);
    pick("Z-A");
    expect(names()).toEqual(["Zebra", "Alpha"]);
    pick("Oldest first");
    expect(names()).toEqual(["Alpha", "Zebra"]);
  });

  it("hides create, edit and delete without the matching job_tags permissions", () => {
    canMock.mockImplementation((resource: string, action: string) => action === "view");

    render(<JobTagCombobox value={[]} onChange={vi.fn()} />);
    openPicker();

    expect(screen.queryByRole("button", { name: /create new/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete /i })).not.toBeInTheDocument();
  });
});

/**
 * Workiz's catalog as the import leaves it: every tag created the day of the
 * import, its place in Workiz's catalog kept as `priority` (first of N → N).
 * The job page header prints a job's tags in that order (MS9277: "waiting
 * for approval · PLATINUM · BID/Solicitation"), and the "+" window opens on
 * the newest — "waiting for docs" first (job_b_02_tags_add).
 */
describe("JobTagCombobox — Workiz's order on the job page", () => {
  const imported = "2026-09-30T00:00:00.000Z";
  const workizCatalog = [
    makeTag({ id: "bid", name: "BID/Solicitation", color: "blue", priority: 29, createdAt: imported }),
    makeTag({ id: "plat", name: "PLATINUM", color: "blue", priority: 97, createdAt: imported }),
    makeTag({ id: "wait", name: "waiting for approval", color: "pink", priority: 126, createdAt: imported }),
    makeTag({ id: "docs", name: "waiting for docs", color: "amber", priority: 1, createdAt: imported }),
  ];

  beforeEach(() => {
    canMock.mockReturnValue(true);
    catalog.loading = false;
    catalog.tags = workizCatalog;
  });

  it("prints the job's tags in catalog order in the header, whatever order the job keeps them in", () => {
    const { container } = render(<JobTagCombobox variant="workiz" value={["bid", "plat", "wait"]} onChange={vi.fn()} />);
    const chips = [...container.querySelectorAll("span.relative")].map((c) => c.textContent);
    expect(chips).toEqual(["waiting for approval", "PLATINUM", "BID/Solicitation"]);
  });

  it("takes off exactly the tag whose × was pressed, the rest in the job's own order", () => {
    const onChange = vi.fn();
    render(<JobTagCombobox variant="workiz" value={["bid", "plat", "wait"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove PLATINUM" }));
    expect(onChange).toHaveBeenCalledWith(["bid", "wait"]);
  });

  it("opens the + window on the newest tag, the catalog backwards", () => {
    render(<JobTagCombobox variant="workiz" value={[]} onChange={vi.fn()} />);
    openPicker();
    const names = screen.getAllByRole("option").map((o) => o.textContent?.replace(/Edit|Delete/g, "").trim());
    expect(names).toEqual(["waiting for docs", "BID/Solicitation", "PLATINUM", "waiting for approval"]);
  });
});
