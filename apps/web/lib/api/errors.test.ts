import { describe, it, expect } from "vitest";
import { responseError } from "./errors";

/**
 * Uploads and downloads go straight to S3 over a presigned URL, so a failure
 * there never reached the API's error envelope — it said "Upload failed" and
 * nothing else, even when S3 had said exactly why.
 */
describe("responseError — a raw fetch's failure with its reason", () => {
  it("reads S3's XML reason", async () => {
    const res = new Response(
      "<?xml version=\"1.0\"?><Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>",
      { status: 403 },
    );
    const err = await responseError(res, "Document upload failed");
    expect(err.message).toBe("Document upload failed (HTTP 403: Request has expired)");
  });

  it("reads our API envelope", async () => {
    const res = new Response(
      JSON.stringify({ success: false, error: { code: "NOT_FOUND", message: "Recording not found" } }),
      { status: 404 },
    );
    expect((await responseError(res, "Recording unavailable")).message).toBe(
      "Recording unavailable (HTTP 404: Recording not found)",
    );
  });

  it("names the status when the body says nothing", async () => {
    const res = new Response("", { status: 500 });
    expect((await responseError(res, "Download failed")).message).toBe("Download failed (HTTP 500)");
  });
});
