import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContainerCreateDialog } from "./container-create-dialog";

const mutate = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("../hooks", () => ({
  useCreateContainer: () => ({ mutate, isPending: false }),
}));

vi.mock("@/features/inventory/templates/hooks", () => ({
  useContainerTemplates: () => ({
    data: [
      { id: "tp1", name: "Standard van", items: [], status: "active", createdAt: "", updatedAt: "" },
    ],
    isLoading: false,
    isSuccess: true,
    isError: false,
  }),
  useContainerTemplate: () => ({ data: undefined, isLoading: false, isError: false }),
}));

describe("ContainerCreateDialog", () => {
  beforeEach(() => {
    mutate.mockReset();
    push.mockReset();
  });

  it("creates a container from name, description and department", async () => {
    render(<ContainerCreateDialog open onOpenChange={() => {}} />);

    await userEvent.type(screen.getByLabelText("Location Name"), "Van 5");
    await userEvent.type(screen.getByLabelText("Description"), "Spare van");
    await userEvent.type(screen.getByLabelText("Department"), "Locksmith");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Van 5",
        description: "Spare van",
        department: "Locksmith",
      }),
      expect.anything(),
    );
  });

  // Who works from the van is set on User containers, not here.
  it("asks for no technician", () => {
    render(<ContainerCreateDialog open onOpenChange={() => {}} />);
    expect(screen.queryByText(/technician/i)).toBeNull();
  });

  it("can start the van on a template", async () => {
    render(<ContainerCreateDialog open onOpenChange={() => {}} />);

    await userEvent.type(screen.getByLabelText("Location Name"), "Van 6");
    await userEvent.click(screen.getByRole("combobox", { name: "Template" }));
    await userEvent.click(await screen.findByRole("option", { name: "Standard van" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Van 6", templateId: "tp1" }),
      expect.anything(),
    );
  });

  it("sends no template when none is picked", async () => {
    render(<ContainerCreateDialog open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText("Location Name"), "Van 7");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate.mock.calls[0][0]).not.toHaveProperty("templateId");
    expect(mutate.mock.calls[0][0]).not.toHaveProperty("technicianId");
  });

  it("closes once created and stays on the list — there is no container page to go to", async () => {
    mutate.mockImplementation((_body, opts) => opts.onSuccess({ id: "c5", name: "Van 5" }));
    const onOpenChange = vi.fn();
    render(<ContainerCreateDialog open onOpenChange={onOpenChange} />);

    await userEvent.type(screen.getByLabelText("Location Name"), "Van 5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    render(<ContainerCreateDialog open onOpenChange={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });
});
