import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobSuperStatus, type DealSubStatus } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  statuses: [] as DealSubStatus[],
  update: vi.fn(),
  remove: vi.fn(),
  can: vi.fn<(resource: string, action?: string) => boolean>(() => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can, isLoading: false }),
}));
vi.mock("../hooks", () => ({
  useJobStatuses: () => ({ data: mocks.statuses, isLoading: false, isSuccess: true, status: "success", fetchStatus: "idle" }),
  useDeleteJobStatus: () => ({ mutate: mocks.remove, isPending: false }),
  useUpdateJobStatus: (id: string) => ({ mutate: (body: unknown) => mocks.update(id, body), isPending: false }),
}));
vi.mock("./job-status-form-dialog", () => ({
  JobStatusFormDialog: ({ status }: { status?: DealSubStatus }) => (
    <div data-testid="form">{status ? `editing ${status.name}` : "creating"}</div>
  ),
}));

const { JobStatusesPage } = await import("./job-statuses-page");

const status = (over: Partial<DealSubStatus> = {}): DealSubStatus => ({
  id: "st-call",
  name: "Will Call Back",
  group: JobSuperStatus.PENDING,
  color: "red",
  priority: 1,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
} as DealSubStatus);

describe("JobStatusesPage — Workiz's Sub Status", () => {
  beforeEach(() => {
    mocks.statuses = [status(), status({ id: "st-old", name: "Old One", active: false })];
    mocks.update.mockReset();
    mocks.remove.mockReset();
    mocks.can.mockReset();
    mocks.can.mockReturnValue(true);
  });

  it("lists every status flat, its parent and colour beside it, 50 to a page", () => {
    render(<JobStatusesPage />);
    const table = screen.getByRole("table", { name: "Job statuses" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Sub Name",
      "Sub Parent",
      "Color",
      "Status",
      "Actions",
    ]);
    const row = within(table).getByText("Will Call Back").closest("tr")!;
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    expect(within(row).getByRole("img", { name: "red" })).toBeInTheDocument();
    // Archived ones stay listed (Workiz has no Show: here), switched off.
    expect(screen.getByRole("switch", { name: "Old One status" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toHaveValue("50");
  });

  it("switches a status off from its row, and opens Add New and an edit", async () => {
    render(<JobStatusesPage />);
    await userEvent.click(screen.getByRole("switch", { name: "Will Call Back status" }));
    expect(mocks.update).toHaveBeenCalledWith("st-call", { active: false });
    await userEvent.click(screen.getByRole("button", { name: "Add New" }));
    expect(screen.getByTestId("form")).toHaveTextContent("creating");
    await userEvent.click(screen.getByRole("button", { name: "Edit Will Call Back" }));
    expect(screen.getByTestId("form")).toHaveTextContent("editing Will Call Back");
  });

  it("deletes after the confirm", async () => {
    render(<JobStatusesPage />);
    await userEvent.click(screen.getByRole("button", { name: "Delete Will Call Back" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(mocks.remove).toHaveBeenCalledWith("st-call", expect.anything());
  });
});
