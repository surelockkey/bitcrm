import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { DealAttachmentMeta } from "@bitcrm/types";

const { deleteMutate, updateMutate } = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
  updateMutate: vi.fn(),
}));

const photo: DealAttachmentMeta = {
  id: "a-photo",
  fileName: "before.jpg",
  contentType: "image/jpeg",
  size: 1234,
  description: "Broken latch",
  uploadedBy: "u1",
  uploadedAt: "2026-08-01T10:00:00Z",
};

const pdf: DealAttachmentMeta = {
  id: "a-pdf",
  fileName: "invoice.pdf",
  contentType: "application/pdf",
  size: 5678,
  uploadedBy: "u1",
  uploadedAt: "2026-08-01T11:00:00Z",
};

vi.mock("../attachments-hooks", () => ({
  useAttachments: () => ({ data: [photo, pdf], isLoading: false }),
  useDeleteAttachment: () => ({ mutate: deleteMutate, isPending: false }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAttachment: () => ({ mutate: updateMutate, isPending: false }),
  useAttachmentUrl: (_dealId: string, attachmentId: string) =>
    attachmentId === "a-photo"
      ? { data: { downloadUrl: "https://s3.example/thumb.jpg" } }
      : { data: undefined },
}));

// Radix portal/animation wrapper; render children directly.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { DealAttachmentsTab } from "./deal-attachments-tab";

describe("DealAttachmentsTab — Workiz-style rows", () => {
  beforeEach(() => {
    deleteMutate.mockReset();
    updateMutate.mockReset();
  });

  it("renders the actual photo as the row thumbnail, not a stub icon", () => {
    render(<DealAttachmentsTab dealId="d1" canEdit={false} />);

    const img = screen.getByRole("img", { name: "before.jpg" });
    expect(img).toHaveAttribute("src", "https://s3.example/thumb.jpg");
  });

  it("keeps the file icon for non-image attachments", () => {
    render(<DealAttachmentsTab dealId="d1" canEdit={false} />);

    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText("invoice.pdf")).toBeInTheDocument();
  });

  it("falls back to the stub icon when the image bytes fail to load", () => {
    render(<DealAttachmentsTab dealId="d1" canEdit={false} />);

    fireEvent.error(screen.getByRole("img", { name: "before.jpg" }));
    expect(screen.queryByRole("img", { name: "before.jpg" })).not.toBeInTheDocument();
  });

  it("shows the description under the file name", () => {
    render(<DealAttachmentsTab dealId="d1" canEdit={false} />);

    expect(screen.getByText("Broken latch")).toBeInTheDocument();
  });

  it("offers Download and Delete in the row menu — no Send", () => {
    render(<DealAttachmentsTab dealId="d1" canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "More actions for before.jpg" }));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Download")).toBeInTheDocument();
    expect(within(menu).getByText("Delete")).toBeInTheDocument();
    expect(within(menu).queryByText("Send")).not.toBeInTheDocument();
  });

  it("deletes through the row menu", () => {
    render(<DealAttachmentsTab dealId="d1" canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "More actions for before.jpg" }));
    fireEvent.click(within(screen.getByRole("menu")).getByText("Delete"));

    expect(deleteMutate).toHaveBeenCalledWith("a-photo");
  });

  it("hides Delete from the menu without edit rights", () => {
    render(<DealAttachmentsTab dealId="d1" canEdit={false} />);

    fireEvent.click(screen.getByRole("button", { name: "More actions for before.jpg" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Download")).toBeInTheDocument();
    expect(within(menu).queryByText("Delete")).not.toBeInTheDocument();
  });

  it("opens an edit dialog on row click and saves the new name and description", () => {
    render(<DealAttachmentsTab dealId="d1" canEdit />);

    fireEvent.click(screen.getByText("before.jpg"));

    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByDisplayValue("before.jpg");
    const description = within(dialog).getByDisplayValue("Broken latch");
    fireEvent.change(name, { target: { value: "front door.jpg" } });
    fireEvent.change(description, { target: { value: "Latch after repair" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateMutate).toHaveBeenCalledWith(
      { attachmentId: "a-photo", body: { fileName: "front door.jpg", description: "Latch after repair" } },
      expect.anything(),
    );
  });

  it("does not open the edit dialog for read-only users", () => {
    render(<DealAttachmentsTab dealId="d1" canEdit={false} />);

    fireEvent.click(screen.getByText("before.jpg"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
