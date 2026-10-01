import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentSignatureView } from "@bitcrm/types";
import { SignaturesSection } from "./signatures-section";

function stubCanvas() {
  const ctx = { scale: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn() };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,QUJD") as never;
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 160 }) as DOMRect;
}

const signed: DocumentSignatureView = {
  id: "s1",
  kind: "invoice",
  documentId: "d1",
  contactId: "c1",
  signedBy: "Jane Client",
  signedAt: "2026-09-29T13:52:00.000Z",
  source: "portal",
  imageUrl: "https://s3/sig.png",
};

const user = () => userEvent.setup({ pointerEventsCheck: 0 });

describe("SignaturesSection (Workiz Signatures +)", () => {
  beforeEach(() => stubCanvas());

  it("lists who signed, when and where, with the image", () => {
    render(<SignaturesSection signatures={[signed]} signerName="Jane Client" canSign onSign={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /signatures/i })).toBeInTheDocument();
    expect(screen.getByText("Jane Client")).toBeInTheDocument();
    expect(screen.getByText(/client portal/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /signature by jane client/i })).toHaveAttribute("src", "https://s3/sig.png");
  });

  it("says so when nobody has signed, and hides Sign without permission", () => {
    const { rerender } = render(<SignaturesSection signatures={[]} signerName="Jane" canSign={false} onSign={vi.fn()} />);
    expect(screen.getByText(/no signatures yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^sign$/i })).not.toBeInTheDocument();
    rerender(<SignaturesSection signatures={[]} signerName="Jane" canSign onSign={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^sign$/i })).toBeInTheDocument();
  });

  it("Sign: confirms the signer's name, takes the drawing and saves — disabled until something was drawn", async () => {
    const onSign = vi.fn(async () => undefined);
    render(<SignaturesSection signatures={[]} signerName="Jane Client" canSign onSign={onSign} />);
    await user().click(screen.getByRole("button", { name: /^sign$/i }));
    const name = screen.getByLabelText(/signer/i);
    expect(name).toHaveValue("Jane Client");
    const save = screen.getByRole("button", { name: /save signature/i });
    expect(save).toBeDisabled();
    const canvas = screen.getByRole("img", { name: /sign here/i });
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(save).toBeEnabled();
    await user().clear(name);
    await user().type(name, "J. Client");
    await user().click(save);
    await waitFor(() => expect(onSign).toHaveBeenCalledWith({ imageDataUrl: "data:image/png;base64,QUJD", signedBy: "J. Client" }));
  });
});
