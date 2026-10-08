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
  <DashboardCard title="Top Sources" action="view_top_sources" query={q} onRemove={vi.fn()} {...extra}>
    {(data) => <p>{data}</p>}
  </DashboardCard>
);

/**
 * Рамка віджета як у Workiz Home: «updated …» лише там, де Workiz його
 * показує, «?» лише там, де він пояснює віджет, ↻, меню з «Manage Permissions»
 * і «Remove», «View All» внизу.
 */
describe("DashboardCard", () => {
  it("renders the body from the data", () => {
    renderWithClient(card(query()));
    expect(screen.getByRole("heading", { name: "Top Sources" })).toBeInTheDocument();
    expect(screen.getByText("the numbers")).toBeInTheDocument();
  });

  it("stamps 'updated' only on a widget Workiz stamps", () => {
    const { unmount } = renderWithClient(card(query()));
    expect(screen.queryByText(/^updated /)).toBeNull();
    unmount();
    renderWithClient(card(query(), { stamped: true }));
    expect(screen.getByText(/^updated /)).toBeInTheDocument();
  });

  // Знімок будується вночі: «updated» — коли його порахували, а не коли браузер його забрав.
  it("says when the snapshot was computed, not when it was fetched", () => {
    const computedAt = "2026-09-28T07:00:00.000Z";
    renderWithClient(
      <DashboardCard title="Top Sources" action="view_top_sources" stamped onRemove={vi.fn()} query={{ ...query(), data: { computedAt } } as never}>
        {() => <p>body</p>}
      </DashboardCard>,
    );
    expect(screen.getByText(`updated ${updatedAtLabel(new Date(computedAt))}`)).toBeInTheDocument();
  });

  it("carries the ? only with help to give", () => {
    const { unmount } = renderWithClient(card(query()));
    expect(screen.queryByRole("button", { name: "About Top Sources" })).toBeNull();
    unmount();
    renderWithClient(card(query(), { help: "Where jobs came from." }));
    expect(screen.getByRole("button", { name: "About Top Sources" })).toBeInTheDocument();
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

  it("refetches on the refresh arrows", () => {
    const q = query();
    renderWithClient(card(q));
    fireEvent.click(screen.getByRole("button", { name: "Refresh Top Sources" }));
    expect(q.refetch).toHaveBeenCalled();
  });

  it("a View All link when the widget has somewhere to go", () => {
    renderWithClient(card(query(), { viewAll: { href: "/calls" } }));
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute("href", "/calls");
  });

  it("offers Manage Permissions to somebody who edits roles, and Remove to everyone", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const { unmount } = renderWithClient(card(query(), { onRemove }));
    await user.click(screen.getByRole("button", { name: "Top Sources options" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Manage Permissions", "Remove"]);
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalled();
    unmount();

    grants["roles.edit"] = false;
    renderWithClient(card(query()));
    await user.click(screen.getByRole("button", { name: "Top Sources options" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Remove"]);
    grants["roles.edit"] = true;
  });
});
