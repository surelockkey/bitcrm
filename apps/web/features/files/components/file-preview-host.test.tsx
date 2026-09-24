import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { useFilePreviewStore, type PreviewFile } from "../preview-store";
import { FilePreviewHost } from "./file-preview-host";

/**
 * Вікно перегляду: PDF і картинку видно просто тут, решту — забрати
 * завантаженням. Стоїть один раз в оболонці застосунку, а відкривають його
 * звідусіль через стор.
 */
const open = (file: PreviewFile) => act(() => useFilePreviewStore.getState().preview(file));

describe("FilePreviewHost", () => {
  beforeEach(() => useFilePreviewStore.setState({ file: null }));

  it("stays out of the way until a file is opened", () => {
    const { container } = render(<FilePreviewHost />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the file it is showing", async () => {
    render(<FilePreviewHost />);

    open({ name: "h6513-454441 receipt", contentType: "application/pdf", load: async () => "blob:x" });

    expect(await screen.findByText("h6513-454441 receipt")).toBeInTheDocument();
  });

  it("shows a pdf in the window itself", async () => {
    render(<FilePreviewHost />);

    open({ name: "receipt.pdf", contentType: "application/pdf", load: async () => "blob:pdf" });

    const frame = await screen.findByTitle("receipt.pdf");
    expect(frame).toHaveAttribute("src", "blob:pdf");
  });

  it("shows an image as an image", async () => {
    render(<FilePreviewHost />);

    open({ name: "mobile upload.jpg", load: async () => "blob:img" });

    const img = await screen.findByRole("img", { name: "mobile upload.jpg" });
    expect(img).toHaveAttribute("src", "blob:img");
  });

  it("offers a download for what a browser cannot show", async () => {
    render(<FilePreviewHost />);

    open({ name: "notes.docx", load: async () => "blob:doc" });

    const link = await screen.findByRole("link", { name: /download/i });
    expect(link).toHaveAttribute("href", "blob:doc");
    expect(screen.queryByTitle("notes.docx")).not.toBeInTheDocument();
  });

  it("says so when the link could not be fetched, instead of a blank window", async () => {
    render(<FilePreviewHost />);

    open({ name: "gone.pdf", load: async () => { throw new Error("Attachment not found"); } });

    expect(await screen.findByText("Attachment not found")).toBeInTheDocument();
  });

  it("closes, and forgets the file so the next one starts clean", async () => {
    const u = userEvent.setup();
    render(<FilePreviewHost />);
    open({ name: "receipt.pdf", contentType: "application/pdf", load: async () => "blob:pdf" });
    await screen.findByTitle("receipt.pdf");

    await u.click(screen.getByRole("button", { name: /close/i }));

    await waitFor(() => expect(useFilePreviewStore.getState().file).toBeNull());
  });

  it("asks for the link again on the next open — a signed url is short-lived", async () => {
    const load = vi.fn(async () => "blob:pdf");
    render(<FilePreviewHost />);

    open({ name: "a.pdf", contentType: "application/pdf", load });
    await screen.findByTitle("a.pdf");
    useFilePreviewStore.getState().close();
    open({ name: "a.pdf", contentType: "application/pdf", load });
    await screen.findByTitle("a.pdf");

    expect(load).toHaveBeenCalledTimes(2);
  });
});
