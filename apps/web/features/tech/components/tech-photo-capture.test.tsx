import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DealAttachmentMeta } from "@bitcrm/types";
import { TechPhotoCapture } from "./tech-photo-capture";

const upload = { mutate: vi.fn(), isPending: false };
const attachments = vi.fn();
vi.mock("@/features/deals/attachments-hooks", () => ({
  useUploadAttachment: () => upload,
  useAttachments: () => attachments(),
}));

const photo = (over: Partial<DealAttachmentMeta> = {}): DealAttachmentMeta => ({
  id: "a1",
  fileName: "meter.jpg",
  contentType: "image/jpeg",
  uploadedBy: "t1",
  uploadedAt: "",
  ...over,
});

describe("TechPhotoCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attachments.mockReturnValue({ data: [] });
  });

  it("offers the camera and the gallery", () => {
    render(<TechPhotoCapture dealId="d1" />);

    expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "From gallery" })).toBeInTheDocument();
    expect(screen.getByText("No photos on this job yet.")).toBeInTheDocument();
  });

  it("opens the camera directly, not the file browser", () => {
    render(<TechPhotoCapture dealId="d1" />);
    const camera = screen.getByLabelText("Take a photo of the job");

    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).toHaveAttribute("accept", "image/*");
    // The gallery input takes several at once; the camera takes one.
    expect(screen.getByLabelText("Add photos from the gallery")).toHaveAttribute("multiple");
  });

  it("uploads what was picked, as photos on the job", async () => {
    render(<TechPhotoCapture dealId="d1" />);
    const file = new File(["x"], "leak.jpg", { type: "image/jpeg" });

    await userEvent.upload(screen.getByLabelText("Take a photo of the job"), file);

    expect(upload.mutate).toHaveBeenCalledWith(
      { file, category: "photo" },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it("counts only the images already on the job", () => {
    attachments.mockReturnValue({
      data: [photo(), photo({ id: "a2" }), photo({ id: "a3", contentType: "application/pdf" })],
    });
    render(<TechPhotoCapture dealId="d1" />);

    expect(screen.getByText("2 photos on this job.")).toBeInTheDocument();
  });
});
