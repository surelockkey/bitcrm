import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PortalDocumentSummary } from "@bitcrm/types";
import { PortalDocumentViewer, type DocumentLoaders } from "./document-viewer";

vi.mock("./navigate", () => ({ goTo: vi.fn() }));
import { goTo } from "./navigate";

const doc: PortalDocumentSummary = {
  kind: "invoice",
  id: "d1",
  number: "1042",
  date: "2026-09-12",
  status: "due",
  total: 300,
  balanceDue: 300,
  sent: true,
};

function loaders(over: Partial<DocumentLoaders> = {}): DocumentLoaders {
  return {
    getHtml: vi.fn(async () => ({ html: "<html><head></head><body>doc</body></html>" })),
    getPdfUrl: vi.fn(async (_d, download) => ({ url: download ? "https://s3/dl.pdf" : "https://s3/view.pdf" })),
    ...over,
  };
}

describe("PortalDocumentViewer", () => {
  beforeEach(() => vi.mocked(goTo).mockClear());

  it("renders nothing without a document", () => {
    const { container } = render(<PortalDocumentViewer doc={null} onClose={() => {}} loaders={loaders()} scope="t" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the document as a page first — not as an embedded PDF", async () => {
    const l = loaders();
    render(<PortalDocumentViewer doc={doc} onClose={() => {}} loaders={l} scope="t" />);
    expect(screen.getByRole("dialog", { name: "Invoice #1042" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/loading invoice/i);
    const frame = await screen.findByTitle("Invoice #1042");
    expect(frame.getAttribute("srcdoc")).toContain("doc");
    expect(l.getHtml).toHaveBeenCalledWith(doc);
    // The PDF is not fetched until someone asks for it.
    expect(l.getPdfUrl).not.toHaveBeenCalled();
  });

  it("downloads the PDF on demand", async () => {
    const l = loaders();
    render(<PortalDocumentViewer doc={doc} onClose={() => {}} loaders={l} scope="t" />);
    await userEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    await waitFor(() => expect(goTo).toHaveBeenCalledWith("https://s3/dl.pdf"));
    expect(l.getPdfUrl).toHaveBeenCalledWith(doc, true);
  });

  it("opens the PDF in the tab it opened up front", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    render(<PortalDocumentViewer doc={doc} onClose={() => {}} loaders={loaders()} scope="t" />);
    await userEvent.click(screen.getByRole("button", { name: /open pdf/i }));
    await waitFor(() => expect(tab.location.href).toBe("https://s3/view.pdf"));
  });

  it("closes the tab and says so when the PDF cannot be prepared", async () => {
    const tab = { location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    render(
      <PortalDocumentViewer
        doc={doc}
        onClose={() => {}}
        loaders={loaders({ getPdfUrl: vi.fn().mockRejectedValue(new Error("boom")) })}
        scope="t"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /open pdf/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't open the pdf/i);
    expect(tab.close).toHaveBeenCalled();
  });

  it("falls back to the PDF buttons when the page cannot load, and retries", async () => {
    const getHtml = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ html: "<html><head></head><body>ok</body></html>" });
    render(<PortalDocumentViewer doc={doc} onClose={() => {}} loaders={loaders({ getHtml })} scope="t" />);
    expect(await screen.findByText(/couldn't show this invoice on the page/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download pdf/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect((await screen.findByTitle("Invoice #1042")).getAttribute("srcdoc")).toContain("ok");
    expect(getHtml).toHaveBeenCalledTimes(2);
  });

  it("closes on Back and on Escape, and locks page scroll while open", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<PortalDocumentViewer doc={doc} onClose={onClose} loaders={loaders()} scope="t" />);
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.click(screen.getByRole("button", { name: /back to all documents/i }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("paying from the document", () => {
  const payable: PortalDocumentSummary = { ...doc, payable: true, balanceDue: 120.5 };

  it("offers Pay now carrying the balance, not the total", async () => {
    const onPay = vi.fn();
    render(<PortalDocumentViewer doc={payable} onClose={() => {}} loaders={loaders()} scope="t" onPay={onPay} />);
    await userEvent.click(screen.getByRole("button", { name: /pay \$120\.50/i }));
    expect(onPay).toHaveBeenCalledWith(payable);
  });

  it("says why instead of offering a dead button when online payment is off", () => {
    render(<PortalDocumentViewer doc={{ ...doc, payable: false }} onClose={() => {}} loaders={loaders()} scope="t" onPay={() => {}} />);
    expect(screen.queryByRole("button", { name: /^pay/i })).toBeNull();
    expect(screen.getByText(/online payment isn't available/i)).toBeInTheDocument();
  });

  it("shows nothing to pay on a settled invoice", () => {
    render(
      <PortalDocumentViewer doc={{ ...doc, status: "paid", balanceDue: 0, payable: true }} onClose={() => {}} loaders={loaders()} scope="t" onPay={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /^pay/i })).toBeNull();
    expect(screen.queryByText(/online payment isn't available/i)).toBeNull();
  });

  it("stays out of the way in the staff preview", () => {
    render(<PortalDocumentViewer doc={payable} onClose={() => {}} loaders={loaders()} scope="t" />);
    expect(screen.queryByRole("button", { name: /^pay/i })).toBeNull();
  });
});
