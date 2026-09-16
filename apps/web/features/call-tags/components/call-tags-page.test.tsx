import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { CallTag } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  tags: [] as CallTag[],
  archive: vi.fn(),
  restore: vi.fn(),
  can: vi.fn<(resource: string, action?: string) => boolean>(() => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can }),
}));
vi.mock("../hooks", () => ({
  useCallTags: () => ({ data: mocks.tags, isLoading: false }),
  useArchiveCallTag: () => ({ mutate: mocks.archive, isPending: false }),
  useRestoreCallTag: () => ({ mutate: mocks.restore, isPending: false }),
}));
vi.mock("./call-tag-form-dialog", () => ({
  CallTagFormDialog: ({ callTag }: { callTag?: CallTag }) => (
    <div data-testid="form">{callTag ? `editing ${callTag.name}` : "creating"}</div>
  ),
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

import { CallTagsPage } from "./call-tags-page";

const tag = (over: Partial<CallTag> = {}): CallTag => ({
  id: "ct-spam",
  name: "SPAM CALLER",
  color: "red",
  priority: 10,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("CallTagsPage", () => {
  beforeEach(() => {
    mocks.tags = [];
    mocks.archive.mockReset();
    mocks.restore.mockReset();
    mocks.can.mockReset();
    mocks.can.mockReturnValue(true);
  });

  it("explains what call tags are for when there are none", () => {
    render(<CallTagsPage />);
    expect(screen.getByText(/no call tags yet/i)).toBeInTheDocument();
  });

  it("lists a tag with its priority and state", () => {
    mocks.tags = [tag(), tag({ id: "ct-old", name: "Lines Testing", priority: 0, active: false })];
    render(<CallTagsPage />);

    expect(screen.getByText("SPAM CALLER")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("opens the form for a new tag and for an existing one", () => {
    mocks.tags = [tag()];
    render(<CallTagsPage />);

    fireEvent.click(screen.getByRole("button", { name: /new call tag/i }));
    expect(screen.getByTestId("form")).toHaveTextContent("creating");

    fireEvent.click(screen.getByRole("button", { name: "Edit SPAM CALLER" }));
    expect(screen.getByTestId("form")).toHaveTextContent("editing SPAM CALLER");
  });

  it("archives after confirming, and says the old calls keep their label", () => {
    mocks.tags = [tag()];
    render(<CallTagsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Archive SPAM CALLER" }));
    expect(mocks.archive).not.toHaveBeenCalled();

    const confirm = screen.getByRole("alertdialog");
    expect(within(confirm).getByText(/keep their label/i)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Archive" }));
    expect(mocks.archive).toHaveBeenCalledWith("ct-spam", expect.anything());
  });

  it("offers restore — not archive — on an archived tag", () => {
    mocks.tags = [tag({ active: false })];
    render(<CallTagsPage />);

    expect(
      screen.queryByRole("button", { name: "Archive SPAM CALLER" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore SPAM CALLER" }));
    expect(mocks.restore).toHaveBeenCalledWith("ct-spam");
  });

  it("hides every control from someone who can only view settings", () => {
    mocks.can.mockImplementation((resource: string, action?: string) => action !== "edit" && !!resource);
    mocks.tags = [tag()];
    render(<CallTagsPage />);

    expect(screen.getByText("SPAM CALLER")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new call tag/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^archive /i })).not.toBeInTheDocument();
  });

  it("says so plainly when telephony settings are off-limits entirely", () => {
    mocks.can.mockReturnValue(false);
    render(<CallTagsPage />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});
