import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobSource } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  sources: [] as JobSource[],
  update: vi.fn(),
  remove: vi.fn(),
  can: vi.fn<(resource: string, action?: string) => boolean>(() => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can, isLoading: false }),
}));
vi.mock("../hooks", () => ({
  useJobSources: () => ({ data: mocks.sources, isLoading: false, isSuccess: true, status: "success", fetchStatus: "idle" }),
  useDeleteJobSource: () => ({ mutate: mocks.remove, isPending: false }),
  useUpdateJobSource: (id: string) => ({ mutate: (body: unknown) => mocks.update(id, body), isPending: false }),
}));
vi.mock("./job-source-form-dialog", () => ({
  JobSourceFormDialog: ({ jobSource }: { jobSource?: JobSource }) => (
    <div data-testid="form">{jobSource ? `editing ${jobSource.name}` : "creating"}</div>
  ),
}));

const { JobSourcesPage } = await import("./job-sources-page");

const source = (over: Partial<JobSource> = {}): JobSource => ({
  id: "js-yelp",
  name: "Yelp",
  priority: 5,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("JobSourcesPage — Workiz's Job Sources", () => {
  beforeEach(() => {
    mocks.sources = [source(), source({ id: "js-old", name: "Old Flyer", active: false })];
    mocks.update.mockReset();
    mocks.remove.mockReset();
    mocks.can.mockReset();
    mocks.can.mockReturnValue(true);
  });

  it("shows the active sources first, under Workiz's columns", () => {
    render(<JobSourcesPage />);
    const table = screen.getByRole("table", { name: "Job sources" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Source Name",
      "Priority",
      "Status",
      "Actions",
    ]);
    expect(within(table).getByText("Yelp")).toBeInTheDocument();
    expect(within(table).queryByText("Old Flyer")).toBeNull();
  });

  it("switches a source off from its row (archiving it) without opening it", async () => {
    render(<JobSourcesPage />);
    await userEvent.click(screen.getByRole("switch", { name: "Yelp status" }));
    expect(mocks.update).toHaveBeenCalledWith("js-yelp", { active: false });
    expect(screen.queryByTestId("form")).toBeNull();
  });

  it("opens Add New and a row's edit", async () => {
    render(<JobSourcesPage />);
    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    expect(screen.getByTestId("form")).toHaveTextContent("creating");
    await userEvent.click(screen.getByRole("button", { name: "Edit Yelp" }));
    expect(screen.getByTestId("form")).toHaveTextContent("editing Yelp");
  });

  it("deletes after the confirm", async () => {
    render(<JobSourcesPage />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Yelp" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(mocks.remove).toHaveBeenCalledWith("js-yelp", expect.anything());
  });

  it("gives someone who may only look no way to change anything", async () => {
    mocks.can.mockImplementation((_r: string, action?: string) => !action || action === "view");
    render(<JobSourcesPage />);
    expect(screen.getByText("Yelp")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add New" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(screen.getByRole("switch", { name: "Yelp status" })).toBeDisabled();
  });
});
