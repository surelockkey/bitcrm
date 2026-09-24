import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Pager } from "@/lib/paging/use-pager";
import { ListPagination } from "./list-pagination";

/**
 * Панель під списком: скільки рядків видно з усіх, куди перейти і по скільки
 * вантажити. Стоїть під кожною таблицею, де рядків може бути багато, тож
 * поводиться скрізь однаково.
 */
function pager(over: Partial<Pager<number>> = {}): Pager<number> {
  return {
    page: 1,
    items: [1, 2],
    from: 1,
    to: 50,
    total: 1234,
    canPrev: false,
    canNext: true,
    isLoading: false,
    isFetching: false,
    window: [1, 2, 3],
    next: vi.fn(async () => {}),
    prev: vi.fn(),
    goto: vi.fn(),
    ...over,
  };
}

const noop = () => {};

describe("ListPagination", () => {
  it("says which rows are on screen and how many there are in total", () => {
    render(<ListPagination pager={pager()} size={50} onSizeChange={noop} />);

    expect(screen.getByText("Showing 1–50 of 1,234")).toBeInTheDocument();
  });

  it("says only what it knows when the total is not counted", () => {
    render(<ListPagination pager={pager({ total: undefined })} size={50} onSizeChange={noop} />);

    expect(screen.getByText("Showing 1–50")).toBeInTheDocument();
  });

  it("marks a total that is only a floor", () => {
    render(
      <ListPagination
        pager={pager({ total: 10_000, totalIsFloor: true })}
        size={50}
        onSizeChange={noop}
      />,
    );

    // Сервер спинив лічильник на стелі: «з 10 000» було б неправдою.
    expect(screen.getByText("Showing 1–50 of 10,000+")).toBeInTheDocument();
  });

  it("cannot go back from the first page", () => {
    render(<ListPagination pager={pager()} size={50} onSizeChange={noop} />);

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  it("walks to a page by its number", async () => {
    const p = pager({ page: 2, canPrev: true });
    render(<ListPagination pager={p} size={50} onSizeChange={noop} />);

    await userEvent.click(screen.getByRole("button", { name: "Page 3" }));

    expect(p.goto).toHaveBeenCalledWith(3);
  });

  it("marks the page being looked at", () => {
    render(<ListPagination pager={pager({ page: 2, canPrev: true })} size={50} onSizeChange={noop} />);

    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  });

  it("asks for the next page", async () => {
    const p = pager();
    render(<ListPagination pager={p} size={50} onSizeChange={noop} />);

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(p.next).toHaveBeenCalled();
  });

  it("lets the row count be chosen", async () => {
    const onSizeChange = vi.fn();
    render(<ListPagination pager={pager()} size={50} onSizeChange={onSizeChange} />);

    await userEvent.click(screen.getByRole("combobox", { name: /rows per page/i }));
    await userEvent.click(screen.getByRole("option", { name: "100" }));

    expect(onSizeChange).toHaveBeenCalledWith(100);
  });

  it("holds the numbers back while a single page is all there is", () => {
    render(
      <ListPagination
        pager={pager({ canNext: false, window: [1], total: 2 })}
        size={50}
        onSizeChange={noop}
      />,
    );

    expect(screen.queryByRole("button", { name: "Page 1" })).not.toBeInTheDocument();
    // Рядки й вибір розміру лишаються: сторінка одна, але «по скільки» — питання.
    expect(screen.getByText("Showing 1–50 of 2")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /rows per page/i })).toBeInTheDocument();
  });

  it("shows the gap in a long walk as an unclickable ellipsis", () => {
    render(
      <ListPagination
        pager={pager({ page: 7, canPrev: true, window: [1, "…", 6, 7, 8, "…", 12] })}
        size={50}
        onSizeChange={noop}
      />,
    );

    expect(screen.getAllByText("…")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "…" })).not.toBeInTheDocument();
  });

  it("stands aside entirely while the first page is still loading", () => {
    const { container } = render(
      <ListPagination
        pager={pager({ isLoading: true, items: [] })}
        size={50}
        onSizeChange={noop}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
