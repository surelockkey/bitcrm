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

vi.mock("./technician-select", () => ({
  TechnicianSelect: ({
    onChange,
  }: {
    onChange: (v: { id: string; name: string } | null) => void;
  }) => <button onClick={() => onChange({ id: "t9", name: "Ann Lee" })}>pick-ann</button>,
}));

describe("ContainerCreateDialog", () => {
  beforeEach(() => {
    mutate.mockReset();
    push.mockReset();
  });

  it("creates a container from name, description and department", async () => {
    render(<ContainerCreateDialog open onOpenChange={() => {}} />);

    await userEvent.type(screen.getByLabelText("Name"), "Van 5");
    await userEvent.type(screen.getByLabelText("Description"), "Spare van");
    await userEvent.type(screen.getByLabelText("Department"), "Locksmith");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Van 5",
        description: "Spare van",
        department: "Locksmith",
      }),
      expect.anything(),
    );
  });

  it("can assign a technician right away", async () => {
    render(<ContainerCreateDialog open onOpenChange={() => {}} />);

    await userEvent.type(screen.getByLabelText("Name"), "Van 6");
    await userEvent.click(screen.getByText("pick-ann"));
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Van 6",
        technicianId: "t9",
        technicianName: "Ann Lee",
      }),
      expect.anything(),
    );
  });

  it("closes once created and stays on the list — there is no container page to go to", async () => {
    mutate.mockImplementation((_body, opts) => opts.onSuccess({ id: "c5", name: "Van 5" }));
    const onOpenChange = vi.fn();
    render(<ContainerCreateDialog open onOpenChange={onOpenChange} />);

    await userEvent.type(screen.getByLabelText("Name"), "Van 5");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("requires a name", async () => {
    render(<ContainerCreateDialog open onOpenChange={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });
});
