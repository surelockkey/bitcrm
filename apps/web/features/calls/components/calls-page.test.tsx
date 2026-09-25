import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The call log's history section. What is pinned here is the difference
 * between "there are none" and "none in the stretch searched so far": a
 * filtered page is filled by walking the log newest-first and the server stops
 * after a bounded stretch, so an empty page that carries a cursor must offer
 * to read on rather than claim the search is over.
 */
const mocks = vi.hoisted(() => ({
  fetchNextPage: vi.fn(),
  /** Розмір сторінки, з яким сторінка покликала хук. */
  listArgs: [] as number[],
  list: {
    data: { pages: [{ data: [] as Array<{ callSid: string }> }] },
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
  },
}));

vi.mock("../hooks", () => ({
  useCallsList: (_filter: unknown, limit: number) => {
    mocks.listArgs.push(limit);
    return { ...mocks.list, fetchNextPage: mocks.fetchNextPage };
  },
  // Лічильник сторінок: цим тестам байдуже число, важливо, що панель не падає
  // без нього.
  useCallsCount: () => ({ data: undefined }),
}));
vi.mock("../use-call-stream", () => ({ useCallStream: () => undefined }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true }),
}));
vi.mock("@/features/call-tags/hooks", () => ({ useCallTags: () => ({ data: [] }) }));
vi.mock("./live-calls", () => ({ LiveCalls: () => <div /> }));
vi.mock("./calls-table", () => ({
  CallsTable: ({ calls }: { calls: Array<{ callSid: string }> }) => (
    <div data-testid="rows">{calls.map((c) => c.callSid).join(",")}</div>
  ),
}));

import { CallsPage } from "./calls-page";

describe("CallsPage — the history section", () => {
  beforeEach(() => {
  localStorage.clear();
    mocks.fetchNextPage.mockReset();
    mocks.list = {
      data: { pages: [{ data: [] }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    };
  });

  it("says there are none only when the whole log has been searched", () => {
    render(<CallsPage />);

    expect(screen.getByText("No calls found")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /keep searching/i }),
    ).not.toBeInTheDocument();
  });

  it("offers to read further back when the page is empty but the walk stopped short", () => {
    mocks.list.hasNextPage = true;
    render(<CallsPage />);

    expect(screen.queryByText("No calls found")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /keep searching/i }));
    expect(mocks.fetchNextPage).toHaveBeenCalled();
  });

  it("pages under a list that did find calls", () => {
    mocks.list.data = { pages: [{ data: [{ callSid: "CA1" }] }] };
    mocks.list.hasNextPage = true;
    render(<CallsPage />);

    expect(screen.getByTestId("rows")).toHaveTextContent("CA1");
    expect(screen.getByRole("button", { name: "Next page" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /rows per page/i })).toBeInTheDocument();
  });

  it("asks the server for as many calls as the reader chose", () => {
    mocks.list.data = { pages: [{ data: [{ callSid: "CA1" }] }] };
    render(<CallsPage />);

    fireEvent.click(screen.getByRole("combobox", { name: /rows per page/i }));
    fireEvent.click(screen.getByRole("option", { name: "100" }));

    expect(mocks.listArgs[mocks.listArgs.length - 1]).toBe(100);
  });
});
