import { describe, it, expect, beforeEach } from "vitest";
import { isImage, isPdf, useFilePreviewStore } from "./preview-store";

/**
 * Вкладення відкривалось у новій вкладці: читач губив роботу з очей, а
 * повернутись міг лише через історію браузера. Тепер файл показує вікно
 * поверх сторінки — одне на весь застосунок, бо вкладення є і в роботі, і в
 * документах техніка, і в переписці.
 */
describe("useFilePreviewStore", () => {
  beforeEach(() => useFilePreviewStore.setState({ file: null }));

  it("holds nothing until something is opened", () => {
    expect(useFilePreviewStore.getState().file).toBeNull();
  });

  it("opens a file by name and by how its url is fetched", async () => {
    const load = async () => "https://signed.example/receipt.pdf";

    useFilePreviewStore.getState().preview({ name: "receipt.pdf", contentType: "application/pdf", load });

    const { file } = useFilePreviewStore.getState();
    expect(file?.name).toBe("receipt.pdf");
    expect(await file?.load()).toBe("https://signed.example/receipt.pdf");
  });

  it("closes, so the next open starts clean", () => {
    useFilePreviewStore.getState().preview({ name: "a.pdf", load: async () => "u" });

    useFilePreviewStore.getState().close();

    expect(useFilePreviewStore.getState().file).toBeNull();
  });
});

describe("what kind of file it is", () => {
  it("knows an image by its type, and by its name when the type is missing", () => {
    expect(isImage({ name: "a.png", contentType: "image/png", load: async () => "" })).toBe(true);
    expect(isImage({ name: "photo.JPG", load: async () => "" })).toBe(true);
    expect(isImage({ name: "notes.txt", load: async () => "" })).toBe(false);
  });

  it("knows a pdf the same two ways", () => {
    expect(isPdf({ name: "x", contentType: "application/pdf", load: async () => "" })).toBe(true);
    expect(isPdf({ name: "receipt.PDF", load: async () => "" })).toBe(true);
    expect(isPdf({ name: "receipt.png", load: async () => "" })).toBe(false);
  });
});
