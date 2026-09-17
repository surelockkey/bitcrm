import { afterEach, describe, expect, it, vi } from "vitest";
import { openPdfInNewTab } from "./open-pdf";

afterEach(() => vi.restoreAllMocks());

describe("openPdfInNewTab", () => {
  it("opens the tab before the URL resolves, then points it at the PDF", async () => {
    const tab = { location: { href: "" }, close: vi.fn(), opener: {} as unknown };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    let resolve!: (v: { url: string }) => void;
    const p = openPdfInNewTab(() => new Promise((r) => (resolve = r)));
    expect(open).toHaveBeenCalledTimes(1);
    resolve({ url: "https://files.test/a.pdf" });
    await p;
    expect(tab.location.href).toBe("https://files.test/a.pdf");
    expect(tab.opener).toBeNull();
  });

  it("closes the blank tab and rethrows when the URL can't be fetched", async () => {
    const tab = { location: { href: "" }, close: vi.fn(), opener: null };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    await expect(openPdfInNewTab(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(tab.close).toHaveBeenCalled();
  });
});
