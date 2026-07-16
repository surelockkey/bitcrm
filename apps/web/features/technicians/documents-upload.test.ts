import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadDocumentBytes } from "./api";

const file = new File(["x"], "dl.png", { type: "image/png" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadDocumentBytes", () => {
  it("replays the SSE-KMS headers the backend signed into the presigned PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const headers = {
      "Content-Type": "image/png",
      "x-amz-server-side-encryption": "aws:kms",
      "x-amz-server-side-encryption-aws-kms-key-id": "alias/bitcrm-documents",
    };

    await uploadDocumentBytes("https://s3/upload", file, headers);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3/upload",
      expect.objectContaining({ method: "PUT", headers, body: file }),
    );
  });

  it("falls back to Content-Type when the backend sends no headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await uploadDocumentBytes("https://s3/upload", file);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3/upload",
      expect.objectContaining({ headers: { "Content-Type": "image/png" } }),
    );
  });

  it("throws when S3 rejects the upload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(uploadDocumentBytes("https://s3/upload", file)).rejects.toThrow(
      "Document upload failed",
    );
  });
});
