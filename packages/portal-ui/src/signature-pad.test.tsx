import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SignaturePad } from "./signature-pad";

/** jsdom has no canvas: a 2D context of recorded calls and a fixed data URL. */
function stubCanvas() {
  const ctx = {
    lineWidth: 0,
    lineCap: "",
    lineJoin: "",
    strokeStyle: "",
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
  };
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as never;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,QUJD") as never;
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 160 }) as DOMRect;
  return ctx;
}

describe("SignaturePad", () => {
  let ctx: ReturnType<typeof stubCanvas>;
  beforeEach(() => {
    ctx = stubCanvas();
  });

  it("starts empty, draws with the pointer and hands back a PNG data URL once something was drawn", () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole("img", { name: /sign here/i });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(ctx.lineTo).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith("data:image/png;base64,QUJD");
  });

  it("Clear wipes the canvas and reports an empty signature again", () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const canvas = screen.getByRole("img", { name: /sign here/i });
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("ignores pointer input while disabled", () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} disabled />);
    const canvas = screen.getByRole("img", { name: /sign here/i });
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(ctx.lineTo).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining("data:"));
  });
});
