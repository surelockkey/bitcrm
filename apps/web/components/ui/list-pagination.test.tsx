import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Pager } from "@/lib/paging/use-pager";
import { ListPagination } from "./list-pagination";

/**
 * Панель під списком: скільки рядків видно з усіх, куди перейти і по скільки
 * вантажити. Стоїть під кожною таблицею, де рядків може бути багато, тож
 * поводиться скрізь однаково — і виглядає як підвал списку Workiz
 * (list_07_bottom): «Showing 1 to 50 of 208 results», ‹ «Page 1 of 5» ›.
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
    isStale: false,
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

    // Workiz's react-table prints the count raw ("1234"), so the kit does.
    expect(screen.getByText("Showing 1 to 50 of 1234 results")).toBeInTheDocument();
  });

  it("says only what it knows when the total is not counted", () => {
    render(<ListPagination pager={pager({ total: undefined })} size={50} onSizeChange={noop} />);

    expect(screen.getByText("Showing 1 to 50 results")).toBeInTheDocument();
  });

  // Сервер відповів, що числа для цього викликача немає, — це не те саме, що
  // «не питали», але на екрані виглядає однаково: без «of N».
  it("says only what it knows when the server could not count", () => {
    render(<ListPagination pager={pager({ total: null })} size={50} onSizeChange={noop} />);

    expect(screen.getByText("Showing 1 to 50 results")).toBeInTheDocument();
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
    expect(screen.getByText("Showing 1 to 50 of 10000+ results")).toBeInTheDocument();
  });

  it("cannot go back from the first page", () => {
    render(<ListPagination pager={pager()} size={50} onSizeChange={noop} />);

    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });

  // Workiz's footer has no page numbers — only ‹ "Page 2 of 7" › — and a
  // cursor-paged list cannot jump anyway.
  it("has no page-number buttons, as Workiz's footer has none", () => {
    render(<ListPagination pager={pager({ page: 2, canPrev: true })} size={50} onSizeChange={noop} />);

    expect(screen.queryByRole("button", { name: /^Page \d/ })).not.toBeInTheDocument();
  });

  it("goes back a page", async () => {
    const p = pager({ page: 2, canPrev: true });
    render(<ListPagination pager={p} size={50} onSizeChange={noop} />);

    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));

    expect(p.prev).toHaveBeenCalled();
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

  it("keeps the words and the size picker while a single page is all there is", () => {
    render(
      <ListPagination
        pager={pager({ canNext: false, window: [1], total: 2, to: 2 })}
        size={50}
        onSizeChange={noop}
      />,
    );

    // Рядки й вибір розміру лишаються: сторінка одна, але «по скільки» — питання.
    expect(screen.getByText("Showing 1 to 2 of 2 results")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /rows per page/i })).toBeInTheDocument();
    // Nothing to page through: no ‹ › (a read-only view stays button-free).
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });

  /**
   * Інвентар тримає місце під панель, поки вантажиться перша сторінка:
   * панель, що з'являється разом із рядками, штовхає все під собою.
   */
  it("keeps its place, at its own height, while the first page loads when asked to", () => {
    render(
      <ListPagination
        pager={pager({ isLoading: true, items: [], from: 0, to: 0, total: undefined })}
        size={50}
        onSizeChange={noop}
        reserveSpace
      />,
    );

    const bar = screen.getByTestId("list-pagination");
    expect(bar).toHaveAttribute("aria-busy", "true");
    // No numbers yet — "Showing 0" would be a claim; the size picker is already usable.
    expect(bar).not.toHaveTextContent(/Showing \d/);
    expect(screen.getByRole("combobox", { name: /rows per page/i })).toBeInTheDocument();
  });

  it("is the same bar loading and loaded — one set of classes, so one height", () => {
    const { unmount } = render(
      <ListPagination pager={pager({ isLoading: true, items: [] })} size={50} onSizeChange={noop} reserveSpace />,
    );
    const loading = screen.getByTestId("list-pagination").className;
    unmount();
    render(<ListPagination pager={pager()} size={50} onSizeChange={noop} reserveSpace />);

    expect(screen.getByTestId("list-pagination").className).toBe(loading);
  });

  // "Showing 1 to 50" gains " of 312" and "Page 1" gains " of 7" once the
  // count lands; unreserved, the buttons beside them slid sideways.
  it("reserves the width of the numbers that arrive with the count", () => {
    render(
      <ListPagination pager={pager({ page: 1, totalPages: undefined })} size={50} onSizeChange={noop} />,
    );

    const showing = screen.getByText(/^Showing/);
    const page = screen.getByText(/^Page 1/);
    expect(showing.className).toMatch(/tabular-nums/);
    expect(showing.className).toMatch(/min-w-/);
    // The page words sit in Workiz's fixed 238px block (list_07_bottom): the
    // discs beside them never move, however many digits arrive.
    expect(page.className).toMatch(/tabular-nums/);
    expect(page.parentElement!.className).toMatch(/w-\[238px\]/);
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

  /**
   * «Page 2 of 7». Номери-кнопки показують лише досяжні сторінки — пройдені
   * плюс наступну за курсором — тож із них не видно, скільки їх усього. Саме
   * це число тут і стоїть.
   */
  describe("how many pages there are", () => {
    it("says which page of how many", () => {
      render(
        <ListPagination
          pager={pager({ page: 2, totalPages: 7, totalPagesIsFloor: false })}
          size={50}
          onSizeChange={noop}
        />,
      );

      expect(screen.getByText("Page 2 of 7")).toBeInTheDocument();
    });

    it("marks a page count that is only a floor", () => {
      render(
        <ListPagination
          pager={pager({ page: 1, totalPages: 200, totalPagesIsFloor: true })}
          size={50}
          onSizeChange={noop}
        />,
      );

      expect(screen.getByText("Page 1 of 200+")).toBeInTheDocument();
    });

    it("thousands print raw, as the row count does", () => {
      render(
        <ListPagination
          pager={pager({ page: 1, totalPages: 1234 })}
          size={50}
          onSizeChange={noop}
        />,
      );

      expect(screen.getByText("Page 1 of 1234")).toBeInTheDocument();
    });

    // Технік на інвойсах: сервер сказав, що числа для нього немає.
    it("says which page it is on even when the total is unknown", () => {
      render(
        <ListPagination
          pager={pager({ page: 3, totalPages: undefined })}
          size={50}
          onSizeChange={noop}
        />,
      );

      expect(screen.getByText("Page 3")).toBeInTheDocument();
    });

    // Workiz says "Page 1 of 1" for a one-page list (uikit_wz_client_page).
    it("says Page 1 of 1 when there is only one, as Workiz does", () => {
      render(
        <ListPagination
          pager={pager({ page: 1, totalPages: 1, window: [1], canNext: false })}
          size={50}
          onSizeChange={noop}
        />,
      );

      expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    });
  });
});
