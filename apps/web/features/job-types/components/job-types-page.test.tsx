import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobType } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  types: [] as JobType[],
  update: vi.fn(),
  remove: vi.fn(),
  can: vi.fn<(resource: string, action?: string) => boolean>(() => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can, isLoading: false }),
}));
vi.mock("../hooks", () => ({
  useJobTypes: () => ({ data: mocks.types, isLoading: false, isSuccess: true, status: "success", fetchStatus: "idle" }),
  useDeleteJobType: () => ({ mutate: mocks.remove, isPending: false }),
  useUpdateJobType: (id: string) => ({ mutate: (body: unknown) => mocks.update(id, body), isPending: false }),
}));
vi.mock("./job-type-form-dialog", () => ({
  JobTypeFormDialog: ({ jobType }: { jobType?: JobType }) => (
    <div data-testid="form">{jobType ? `editing ${jobType.name}` : "creating"}</div>
  ),
}));

const { JobTypesPage } = await import("./job-types-page");

const type = (over: Partial<JobType> = {}): JobType => ({
  id: "jt-lock",
  name: "Lockout",
  priority: 5,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("JobTypesPage — Workiz's Job Types", () => {
  beforeEach(() => {
    mocks.types = [type(), type({ id: "jt-old", name: "Old Rekey", active: false })];
    mocks.update.mockReset();
    mocks.remove.mockReset();
    mocks.can.mockReset();
    mocks.can.mockReturnValue(true);
  });

  it("shows the active types first, under Workiz's columns", () => {
    render(<JobTypesPage />);
    const table = screen.getByRole("table", { name: "Job types" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Type Name",
      "Priority",
      "Duration",
      "Status",
      "Actions",
    ]);
    expect(within(table).getByText("Lockout")).toBeInTheDocument();
    // Workiz's Duration column: "1 hours" for a type without one of its own.
    expect(within(table).getByText("1 hours")).toBeInTheDocument();
    expect(within(table).queryByText("Old Rekey")).toBeNull();
  });

  it("switches a type off from its row (archiving it) without opening it", async () => {
    render(<JobTypesPage />);
    await userEvent.click(screen.getByRole("switch", { name: "Lockout status" }));
    expect(mocks.update).toHaveBeenCalledWith("jt-lock", { active: false });
    expect(screen.queryByTestId("form")).toBeNull();
  });

  it("opens Add New and a row's edit", async () => {
    render(<JobTypesPage />);
    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    expect(screen.getByTestId("form")).toHaveTextContent("creating");
    await userEvent.click(screen.getByRole("button", { name: "Edit Lockout" }));
    expect(screen.getByTestId("form")).toHaveTextContent("editing Lockout");
  });

  it("deletes after the confirm", async () => {
    render(<JobTypesPage />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Lockout" }));
    expect(mocks.remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    expect(mocks.remove).toHaveBeenCalledWith("jt-lock", expect.anything());
  });

  it("gives someone who may only look no way to change anything", async () => {
    mocks.can.mockImplementation((_r: string, action?: string) => !action || action === "view");
    render(<JobTypesPage />);
    expect(screen.getByText("Lockout")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add New" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(screen.getByRole("switch", { name: "Lockout status" })).toBeDisabled();
  });
});
