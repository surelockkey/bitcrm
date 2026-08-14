import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DealAttachmentMeta } from "@bitcrm/types";

const photo: DealAttachmentMeta = {
  id: "a-photo",
  fileName: "before.jpg",
  contentType: "image/jpeg",
  size: 1234,
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
  useDeleteAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadAttachment: () => ({ mutate: vi.fn(), isPending: false }),
  useAttachmentUrl: (_dealId: string, attachmentId: string) =>
    attachmentId === "a-photo"
      ? { data: { downloadUrl: "https://s3.example/thumb.jpg" } }
      : { data: undefined },
}));

import { DealAttachmentsTab } from "./deal-attachments-tab";

describe("DealAttachmentsTab — photo thumbnails", () => {
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
});
