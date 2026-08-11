import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http } from "@/lib/api/http";
import { uploadAttachment, uploadAttachmentBytes } from "./attachments-api";

vi.mock("@/lib/api/http", () => ({
  http: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const file = new File(["hello"], "before.png", { type: "image/png" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("uploadAttachmentBytes", () => {
  it("replays the SSE-KMS headers the backend signed into the presigned PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const headers = {
      "Content-Type": "image/png",
      "x-amz-server-side-encryption": "aws:kms",
      "x-amz-server-side-encryption-aws-kms-key-id": "alias/bitcrm-documents",
    };

    await uploadAttachmentBytes("https://s3/upload", file, headers);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3/upload",
      expect.objectContaining({ method: "PUT", headers, body: file }),
    );
  });

  it("falls back to Content-Type when the backend sends no headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await uploadAttachmentBytes("https://s3/upload", file);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3/upload",
      expect.objectContaining({ headers: { "Content-Type": "image/png" } }),
    );
  });

  it("throws when S3 rejects the upload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(uploadAttachmentBytes("https://s3/upload", file)).rejects.toThrow(
      "Attachment upload failed",
    );
  });
});

describe("uploadAttachment (orchestration)", () => {
  beforeEach(() => {
    vi.mocked(http.post).mockResolvedValue({
      id: "att-1",
      uploadUrl: "https://s3/upload",
      s3Key: "deals/d1/attachments/att-1",
      headers: { "Content-Type": "image/png" },
    });
  });

  it("requests an upload ticket derived from the file, then PUTs the bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await uploadAttachment("d1", file, "before");

    expect(http.post).toHaveBeenCalledWith("/deals/d1/attachments", {
      fileName: "before.png",
      contentType: "image/png",
      size: file.size,
      category: "before",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3/upload",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: file,
      }),
    );
  });

  it("omits the category when none is given", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    await uploadAttachment("d1", file);
    expect(http.post).toHaveBeenCalledWith("/deals/d1/attachments", {
      fileName: "before.png",
      contentType: "image/png",
      size: file.size,
      category: undefined,
    });
  });
});
