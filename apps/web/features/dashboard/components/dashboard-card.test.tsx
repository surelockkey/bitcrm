import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithClient } from "@/test/render-with-client";
import { updatedAtLabel } from "../jobs-by-status";
import { DashboardCard, type WidgetQuery } from "./dashboard-card";

const grants: Record<string, boolean> = { "roles.edit": true };
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: (resource: string, action: string) => grants[`${resource}.${action}`] ?? false,
  }),
}));

const query = (over: Partial<WidgetQuery<string>> = {}): WidgetQuery<string> => ({
  data: "the numbers",
  isLoading: false,
  isError: false,
  isFetching: false,
  dataUpdatedAt: Date.parse("2026-09-28T07:08:00.000Z"),
  refetch: vi.fn(),
  ...over,
});

const card = (q: WidgetQuery<string>, extra: Partial<Parameters<typeof DashboardCard<string>>[0]> = {}) => (
  <DashboardCard title="Top Sources" help="Where jobs came from." action="view_top_sources" query={q} {...extra}>
    {(data) => <p>{data}</p>}
  </DashboardCard>
);

/**
 * Рамка кожного віджета дашборда — те, що на скриншотах Workiz однакове в усіх:
 * назва, «updated 3:08 AM», оновити, три крапки, власний період, «View All».
 */
describe("DashboardCard", () => {
  it("renders the body from the data", () => {
    renderWithClient(card(query()));
    expect(screen.getByRole("heading", { name: "Top Sources" })).toBeInTheDocument();
    expect(screen.getByText("the numbers")).toBeInTheDocument();
    expect(screen.getByText(/^updated /)).toBeInTheDocument();
  });

  it("a skeleton while the first answer is on its way, not the body", () => {
    renderWithClient(card(query({ isLoading: true, data: undefined })));
    expect(screen.queryByText("the numbers")).toBeNull();
    expect(screen.getByTestId("widget-skeleton")).toBeInTheDocument();
  });

  it("says so when the widget could not load", () => {
    renderWithClient(card(query({ isError: true, data: undefined })));
    expect(screen.getByText("Couldn't load this widget.")).toBeInTheDocument();
  });

  it("refetches on the refresh button", () => {
    const q = query();
    renderWithClient(card(q));
    fireEvent.click(screen.getByRole("button", { name: "Refresh Top Sources" }));
    expect(q.refetch).toHaveBeenCalled();
  });

  it("offers a range picker only to a widget that has a range", () => {
    const onRangeChange = vi.fn();
    const { unmount } = renderWithClient(card(query()));
    expect(screen.queryByRole("combobox", { name: "Range" })).toBeNull();
    unmount();

    renderWithClient(card(query(), { range: 14, onRangeChange }));
    fireEvent.click(screen.getByRole("combobox", { name: "Range" }));
    fireEvent.click(screen.getByRole("option", { name: "Last 30 Days" }));
    expect(onRangeChange).toHaveBeenCalledWith(30);
  });

  it("a View All link when the widget has somewhere to go", () => {
    renderWithClient(card(query(), { viewAll: "/calls" }));
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/calls");
  });

  it("offers managing who sees it to somebody who edits roles, and nobody else", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithClient(card(query()));
    await user.click(screen.getByRole("button", { name: "Top Sources options" }));
    expect(await screen.findByRole("menuitem", { name: "Manage permissions" })).toBeInTheDocument();
    unmount();

    grants["roles.edit"] = false;
    renderWithClient(card(query()));
    expect(screen.getByRole("button", { name: "Top Sources options" })).toBeDisabled();
    grants["roles.edit"] = true;
  });

  // Знімок будується вночі: «updated» — це коли його порахували, а не коли
  // браузер його забрав, інакше вранці там стояло б «9:15» замість «3:00».
  it("says when the snapshot was computed, not when it was fetched", () => {
    const computedAt = "2026-09-28T07:00:00.000Z";
    renderWithClient(
      <DashboardCard title="Top Sources" help="h" action="view_top_sources" query={{ ...query(), data: { computedAt } } as never}>
        {() => <p>body</p>}
      </DashboardCard>,
    );
    expect(screen.getByText(`updated ${updatedAtLabel(new Date(computedAt))}`)).toBeInTheDocument();
  });
});
