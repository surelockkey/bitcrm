import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobTag } from "@bitcrm/types";

const mocks = vi.hoisted(() => ({
  tags: [] as JobTag[],
  update: vi.fn(),
  remove: vi.fn(),
  can: vi.fn<(resource: string, action?: string) => boolean>(() => true),
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can, isLoading: false }),
}));
vi.mock("../hooks", () => ({
  useJobTags: () => ({ data: mocks.tags, isLoading: false, isSuccess: true, status: "success", fetchStatus: "idle" }),
  useDeleteJobTag: () => ({ mutate: mocks.remove, isPending: false }),
  useUpdateJobTag: (id: string) => ({ mutate: (body: unknown) => mocks.update(id, body), isPending: false }),
}));
vi.mock("./job-tag-form-dialog", () => ({
  JobTagFormDialog: ({ jobTag }: { jobTag?: JobTag }) => (
    <div data-testid="form">{jobTag ? `editing ${jobTag.name}` : "creating"}</div>
  ),
}));

const { JobTagsPage } = await import("./job-tags-page");

const tag = (over: Partial<JobTag> = {}): JobTag => ({
  id: "tg-call",
  name: "Needs a call",
  color: "blue",
  priority: 3,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("JobTagsPage — Sub Status's grid with Job Types' Show:", () => {
  beforeEach(() => {
    mocks.tags = [tag(), tag({ id: "tg-old", name: "Old tag", active: false })];
    mocks.update.mockReset();
    mocks.remove.mockReset();
    mocks.can.mockReset();
    mocks.can.mockReturnValue(true);
  });

  it("lists the active tags with their colour bar", async () => {
    render(<JobTagsPage />);
    const table = screen.getByRole("table", { name: "Job tags" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Tag Name",
      "Color",
      "Priority",
      "Status",
      "Actions",
    ]);
    expect(within(table).getByRole("img", { name: "blue" })).toBeInTheDocument();
    expect(within(table).queryByText("Old tag")).toBeNull();

    await userEvent.click(screen.getByRole("combobox", { name: "Show" }));
    await userEvent.click(await screen.findByRole("option", { name: "All" }));
    expect(within(table).getByText("Old tag")).toBeInTheDocument();
  });

  it("switches a tag off from its row, opens an edit, deletes after the confirm", async () => {
    render(<JobTagsPage />);
    await userEvent.click(screen.getByRole("switch", { name: "Needs a call status" }));
    expect(mocks.update).toHaveBeenCalledWith("tg-call", { active: false });

    await userEvent.click(screen.getByRole("button", { name: "Edit Needs a call" }));
    expect(screen.getByTestId("form")).toHaveTextContent("editing Needs a call");

    await userEvent.click(screen.getByRole("button", { name: "Delete Needs a call" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(mocks.remove).toHaveBeenCalledWith("tg-call", expect.anything());
  });
});
