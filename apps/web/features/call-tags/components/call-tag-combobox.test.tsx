import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { Dialog } from "radix-ui";
import type { CallTag } from "@bitcrm/types";

const { createMutate, updateMutate, archiveMutate, canMock, catalog } = vi.hoisted(
  () => ({
    createMutate: vi.fn(),
    updateMutate: vi.fn(),
    archiveMutate: vi.fn(),
    canMock: vi.fn(),
    catalog: { loading: false },
  }),
);

const makeTag = (over: Partial<CallTag>): CallTag => ({
  id: "ct-1",
  name: "Tech Call",
  color: "red",
  priority: 0,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

// "Wrong number" is newest but last alphabetically, so every sort order is
// distinguishable; "Lines Testing" is archived and must never be offered.
vi.mock("../hooks", () => ({
  useCallTags: () =>
    catalog.loading
      ? { data: undefined, isLoading: true }
      : {
          data: [
            makeTag({
              id: "ct-wrong",
              name: "WRONG NUMBER",
              color: "amber",
              createdAt: "2026-06-01T00:00:00Z",
            }),
            makeTag({
              id: "ct-spam",
              name: "SPAM CALLER",
              color: "red",
              createdAt: "2026-01-01T00:00:00Z",
            }),
            makeTag({
              id: "ct-old",
              name: "Lines Testing",
              active: false,
              createdAt: "2026-03-01T00:00:00Z",
            }),
          ],
          isLoading: false,
        },
  useCreateCallTag: () => ({ mutate: createMutate, isPending: false }),
  useUpdateCallTag: () => ({ mutate: updateMutate, isPending: false }),
  useArchiveCallTag: () => ({ mutate: archiveMutate, isPending: false }),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: canMock }),
}));

// Radix portal/animation wrappers; render children directly.
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
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

import { CallTagCombobox } from "./call-tag-combobox";

const openPicker = () =>
  fireEvent.click(screen.getByRole("button", { name: /add tag/i }));

/**
 * The call quick view mounts this picker inside a modal Sheet — a Radix Dialog,
 * which sets `pointer-events: none` on <body> and traps focus in its content.
 */
const renderInModalSheet = (ui: React.ReactNode) => {
  const onOpenChange = vi.fn();
  render(
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>Incoming call</Dialog.Title>
          {ui}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>,
  );
  return onOpenChange;
};

describe("CallTagCombobox — the tags on one call", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    archiveMutate.mockReset();
    canMock.mockReset();
    canMock.mockReturnValue(true);
    catalog.loading = false;
  });

  it("shows a skeleton pill instead of the raw id while the catalog loads", () => {
    catalog.loading = true;
    const { container } = render(
      <CallTagCombobox value={["ct-spam"]} onChange={vi.fn()} />,
    );

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("ct-spam")).not.toBeInTheDocument();
  });

  it("offers only active tags, and counts them", () => {
    render(<CallTagCombobox value={[]} onChange={vi.fn()} />);
    openPicker();

    expect(screen.getByText("Available tags (2)")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Lines Testing/ })).not.toBeInTheDocument();
  });

  it("adds a tag by picking it, and reports the whole new list", () => {
    const onChange = vi.fn();
    render(<CallTagCombobox value={["ct-wrong"]} onChange={onChange} />);
    openPicker();

    fireEvent.click(screen.getByRole("option", { name: /SPAM CALLER/ }));
    expect(onChange).toHaveBeenCalledWith(["ct-wrong", "ct-spam"]);
  });

  it("takes a tag off from its chip", () => {
    const onChange = vi.fn();
    render(
      <CallTagCombobox value={["ct-spam", "ct-wrong"]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove SPAM CALLER" }));
    expect(onChange).toHaveBeenCalledWith(["ct-wrong"]);
  });

  it("still names an archived tag already on the call, and lets it come off", () => {
    const onChange = vi.fn();
    render(<CallTagCombobox value={["ct-old"]} onChange={onChange} />);

    expect(screen.getByText("Lines Testing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Lines Testing" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("creates a tag via Create new, prefilled with the search query, and puts it on the call", () => {
    createMutate.mockImplementation(
      (body: { name: string }, opts?: { onSuccess?: (t: CallTag) => void }) => {
        opts?.onSuccess?.(makeTag({ id: "ct-new", name: body.name, color: "slate" }));
      },
    );
    const onChange = vi.fn();

    render(<CallTagCombobox value={[]} onChange={onChange} />);
    openPicker();
    fireEvent.change(screen.getByPlaceholderText("Search tags…"), {
      target: { value: "platinum" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create new/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByDisplayValue("platinum")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "platinum" }),
      expect.anything(),
    );
    expect(onChange).toHaveBeenCalledWith(["ct-new"]);
  });

  it("renames a tag from its row without touching the call's selection", () => {
    const onChange = vi.fn();
    render(<CallTagCombobox value={[]} onChange={onChange} />);
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: "Edit SPAM CALLER" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByDisplayValue("SPAM CALLER"), {
      target: { value: "Spam" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Spam" }),
      expect.anything(),
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("archives — never deletes — a tag from its row, after confirming", () => {
    render(<CallTagCombobox value={[]} onChange={vi.fn()} />);
    openPicker();

    fireEvent.click(screen.getByRole("button", { name: "Archive SPAM CALLER" }));
    expect(archiveMutate).not.toHaveBeenCalled();

    const confirm = screen.getByRole("alertdialog");
    expect(
      within(confirm).getByText(/keep their label/i),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Archive" }));
    expect(archiveMutate).toHaveBeenCalledWith("ct-spam");
  });

  it("sorts newest-first by default and offers A-Z, Z-A, newest and oldest", () => {
    render(<CallTagCombobox value={[]} onChange={vi.fn()} />);
    openPicker();

    const names = () =>
      screen
        .getAllByRole("option")
        .map((o) => o.textContent?.replace(/Edit|Archive/g, "").trim());
    const pick = (label: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Sort by" }));
      fireEvent.click(screen.getByRole("menuitemradio", { name: label }));
    };

    // Workiz default: newest first (WRONG NUMBER was created last).
    expect(names()).toEqual(["WRONG NUMBER", "SPAM CALLER"]);
    pick("A-Z");
    expect(names()).toEqual(["SPAM CALLER", "WRONG NUMBER"]);
    pick("Z-A");
    expect(names()).toEqual(["WRONG NUMBER", "SPAM CALLER"]);
    pick("Oldest first");
    expect(names()).toEqual(["SPAM CALLER", "WRONG NUMBER"]);
  });

  it("hides create, edit and archive from someone who cannot edit settings", () => {
    canMock.mockImplementation(
      (resource: string, action?: string) => !!resource && action !== "edit",
    );

    render(<CallTagCombobox value={[]} onChange={vi.fn()} />);
    openPicker();

    expect(screen.queryByRole("button", { name: /create new/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive /i })).not.toBeInTheDocument();
    // Tagging the call itself is still on the table.
    expect(screen.getByRole("option", { name: /SPAM CALLER/ })).toBeInTheDocument();
  });

  it("read-only shows the chips with no way to change them", () => {
    render(<CallTagCombobox value={["ct-spam"]} onChange={vi.fn()} disabled />);

    expect(screen.getByText("SPAM CALLER")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add tag/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^remove /i })).not.toBeInTheDocument();
  });

  it("keeps a click inside a table row from opening the row", () => {
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <CallTagCombobox value={[]} onChange={vi.fn()} stopPropagation />
      </div>,
    );

    openPicker();
    // Also true of the panel itself, which is portaled: React bubbles a
    // portal's events through the tree it was rendered in.
    fireEvent.click(screen.getByPlaceholderText("Search tags…"));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("floats the panel out of the cell, where a table's overflow box cannot clip it", () => {
    // The call log's table wrapper is `overflow-x-auto`, which makes the
    // vertical axis `auto` too — a panel rendered inside the cell is cut off
    // on the lower rows, and a ~330px panel is taller than a row by far.
    const { container } = render(
      <CallTagCombobox value={[]} onChange={vi.fn()} stopPropagation />,
    );
    openPicker();

    const search = screen.getByPlaceholderText("Search tags…");
    expect(container.contains(search)).toBe(false);

    const panel = document.body.querySelector<HTMLElement>(
      "div[style*='position: fixed']",
    );
    expect(panel?.contains(search)).toBe(true);
  });

  it("closes on a click outside without opening the call log row underneath", () => {
    // The panel floats over the page, so the click that dismisses it would
    // otherwise land on whatever row is under it. A backdrop absorbs it.
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <CallTagCombobox value={[]} onChange={vi.fn()} stopPropagation />
      </div>,
    );
    openPicker();
    expect(screen.getByPlaceholderText("Search tags…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByPlaceholderText("Search tags…")).not.toBeInTheDocument();
    expect(rowClick).not.toHaveBeenCalled();
  });

  /**
   * The picker's second mount point is the call quick view, inside a modal
   * Sheet. A panel portaled to <body> with no layer of its own is inert there:
   * `pointer-events` is inherited, so the Sheet's `pointer-events: none` on
   * <body> makes every click fall through to the Sheet's overlay — tapping a
   * tag dismissed the whole quick view — and the Sheet's focus trap pulls focus
   * straight back out of the search box.
   */
  it("stays live inside the modal quick view: picking a tag toggles it and the sheet stays open", () => {
    const onChange = vi.fn();
    const sheetOpenChange = renderInModalSheet(
      <CallTagCombobox value={[]} onChange={onChange} />,
    );

    openPicker();

    expect(document.body.style.pointerEvents).toBe("none");
    const panel = document.querySelector<HTMLElement>(
      "[data-slot='call-tag-panel']",
    );
    expect(panel?.style.pointerEvents).toBe("auto");
    expect(screen.getByPlaceholderText("Search tags…")).toHaveFocus();
    // …and still floated out of the sheet's own scroll box, as in the call log.
    expect(screen.getByRole("dialog").contains(panel)).toBe(false);

    const option = screen.getByRole("option", { name: /SPAM CALLER/ });
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith(["ct-spam"]);
    expect(sheetOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("can be typed into inside the modal quick view", () => {
    renderInModalSheet(<CallTagCombobox value={[]} onChange={vi.fn()} />);
    openPicker();

    const search = screen.getByPlaceholderText("Search tags…");
    fireEvent.change(search, { target: { value: "spam" } });

    expect(search).toHaveFocus();
    expect(screen.getByRole("option", { name: /SPAM CALLER/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /WRONG NUMBER/ })).not.toBeInTheDocument();
  });
});
