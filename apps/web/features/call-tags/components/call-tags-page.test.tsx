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
  // The permissions are in: refused exactly where `can` says no.
  useDenied: () => (resource: string, action?: string) => !mocks.can(resource, action),
  usePermissions: () => ({ can: mocks.can, isLoading: false }),
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

  it("says No Records Found over the empty grid when there are none", () => {
    render(<CallTagsPage />);
    expect(screen.getByText("No Records Found")).toBeInTheDocument();
  });

  it("lists every tag — archived ones too — with its priority and its ON/OFF state", () => {
    mocks.tags = [tag(), tag({ id: "ct-old", name: "Lines Testing", priority: 0, active: false })];
    render(<CallTagsPage />);

    expect(screen.getByText("SPAM CALLER")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Call tags" })).getByText("10")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "SPAM CALLER status" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Lines Testing status" })).not.toBeChecked();
  });

  it("opens the form for a new tag and for an existing one", () => {
    mocks.tags = [tag()];
    render(<CallTagsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Add New" }));
    expect(screen.getByTestId("form")).toHaveTextContent("creating");

    fireEvent.click(screen.getByRole("button", { name: "Edit SPAM CALLER" }));
    expect(screen.getByTestId("form")).toHaveTextContent("editing SPAM CALLER");
  });

  it("archives on the switch after confirming, and says the old calls keep their label", () => {
    mocks.tags = [tag()];
    render(<CallTagsPage />);

    fireEvent.click(screen.getByRole("switch", { name: "SPAM CALLER status" }));
    expect(mocks.archive).not.toHaveBeenCalled();

    const confirm = screen.getByRole("alertdialog");
    expect(within(confirm).getByText(/keep their label/i)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Archive" }));
    expect(mocks.archive).toHaveBeenCalledWith("ct-spam", expect.anything());
  });

  it("restores — no confirm — when an archived tag is switched back on", () => {
    mocks.tags = [tag({ active: false })];
    render(<CallTagsPage />);

    fireEvent.click(screen.getByRole("switch", { name: "SPAM CALLER status" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.restore).toHaveBeenCalledWith("ct-spam");
  });

  it("hides every control from someone who can only view settings", () => {
    mocks.can.mockImplementation((resource: string, action?: string) => action !== "edit" && !!resource);
    mocks.tags = [tag()];
    render(<CallTagsPage />);

    expect(screen.getByText("SPAM CALLER")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add New" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit /i })).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "SPAM CALLER status" })).toBeDisabled();
  });

  it("says so plainly when telephony settings are off-limits entirely", () => {
    mocks.can.mockReturnValue(false);
    render(<CallTagsPage />);
    expect(screen.getByText(/no access/i)).toBeInTheDocument();
  });
});
