import { describe, expect, it } from "vitest";
import { newTemplateSchema, validateImageFile } from "./schemas";

describe("newTemplateSchema", () => {
  it("requires a trimmed name and a kind", () => {
    expect(newTemplateSchema.safeParse({ name: "  ", kind: "invoice" }).success).toBe(false);
    const ok = newTemplateSchema.parse({ name: " Mine ", kind: "estimate", presetId: "modern" });
    expect(ok).toEqual({ name: "Mine", kind: "estimate", presetId: "modern" });
    expect(newTemplateSchema.safeParse({ name: "x", kind: "letter" }).success).toBe(false);
  });
});

describe("validateImageFile", () => {
  it("accepts png/jpeg/webp up to 5MB", () => {
    expect(validateImageFile(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
    expect(validateImageFile(new File(["x"], "a.svg", { type: "image/svg+xml" }))).toMatch(/PNG, JPEG or WebP/);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.jpg", { type: "image/jpeg" });
    expect(validateImageFile(big)).toMatch(/5 MB/);
  });
});
