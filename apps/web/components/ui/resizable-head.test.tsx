import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Table, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "./resizable-head";
import { COLUMN_MIN_WIDTH } from "@/lib/table/use-column-widths";

function head(props: Partial<Parameters<typeof ResizableHead>[0]> = {}) {
  const onResize = vi.fn();
  const onReset = vi.fn();
  render(
    <Table>
      <TableHeader>
        <TableRow>
          <ResizableHead
            columnId="client"
            label="Client"
            width={200}
            onResize={onResize}
            onReset={onReset}
            {...props}
          />
        </TableRow>
      </TableHeader>
    </Table>,
  );
  return { onResize, onReset, handle: screen.getByTestId("resize-client") };
}

// jsdom has no pointer capture; the component calls it on every drag.
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

/**
 * Ручка на правому краї заголовка.
 *
 * Це `separator`, а не кнопка: вона розділяє дві колонки й несе значення —
 * саме тому зчитувач екрана може оголосити ширину, а стрілки поводяться
 * очікувано. Зміна розміру лише мишею лишила б фічу недоступною всім, хто
 * мишею не користується.
 */
describe("ResizableHead", () => {
  it("names the column it resizes", () => {
    const { handle } = head();
    expect(handle).toHaveAttribute("aria-label", "Resize Client");
    expect(handle).toHaveAttribute("role", "separator");
  });

  it("reports the current width and the floor", () => {
    const { handle } = head();
    expect(handle).toHaveAttribute("aria-valuenow", "200");
    expect(handle).toHaveAttribute("aria-valuemin", String(COLUMN_MIN_WIDTH));
  });

  it("widens the column as the pointer travels right", () => {
    const { handle, onResize } = head();

    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 });

    expect(onResize).toHaveBeenLastCalledWith(260);
  });

  it("narrows it on the way back", () => {
    const { handle, onResize } = head();

    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 430, pointerId: 1 });

    expect(onResize).toHaveBeenLastCalledWith(130);
  });

  // Довге перетягування не має накопичувати похибку — рахується від початку.
  it("measures from where the drag began, not from the last frame", () => {
    const { handle, onResize } = head();

    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 520, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 540, pointerId: 1 });

    expect(onResize).toHaveBeenLastCalledWith(240);
  });

  it("does nothing once the pointer is released", () => {
    const { handle, onResize } = head();

    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    onResize.mockClear();
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });

    expect(onResize).not.toHaveBeenCalled();
  });

  it("ignores a move that never began with a press", () => {
    const { handle, onResize } = head();
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("leaves the right mouse button alone", () => {
    const { handle, onResize } = head();

    fireEvent.pointerDown(handle, { button: 2, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 600, pointerId: 1 });

    expect(onResize).not.toHaveBeenCalled();
  });

  it("resizes with the arrow keys", () => {
    const { handle, onResize } = head();

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith(216);

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(184);
  });

  it("puts the column back on double-click and on Home", () => {
    const { handle, onReset } = head();

    fireEvent.doubleClick(handle);
    fireEvent.keyDown(handle, { key: "Home" });

    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it("can be reached by keyboard at all", () => {
    const { handle } = head();
    expect(handle).toHaveAttribute("tabIndex", "0");
  });
});
