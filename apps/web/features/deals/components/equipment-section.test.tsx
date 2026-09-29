import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { DealEquipment } from "@bitcrm/types";

const { createMutate, updateMutate, deleteMutate } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
}));

const opener: DealEquipment = {
  id: "eq-1",
  dealId: "d1",
  contactId: "c1",
  name: "Garage door opener",
  model: "LM-8500",
  brand: "LiftMaster",
  serial: "SN-42",
  laborWarrantyUntil: "2027-09-29",
  locationInProperty: "Garage, left wall",
  createdBy: "t1",
  createdAt: "2026-09-29T10:00:00Z",
  updatedAt: "2026-09-29T10:00:00Z",
};

let mockList: DealEquipment[] = [opener];
vi.mock("../equipment-hooks", () => ({
  useEquipment: () => ({ data: mockList, isLoading: false }),
  useCreateEquipment: () => ({ mutate: createMutate, isPending: false }),
  useUpdateEquipment: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteEquipment: () => ({ mutate: deleteMutate, isPending: false }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { EquipmentSection } from "./equipment-section";

/**
 * Workiz's Equipment on the job: one row a piece — name, model and brand,
 * serial, warranty, where it is — and "Add equipment" opening the same form
 * Workiz has (name and model required).
 */
describe("EquipmentSection", () => {
  beforeEach(() => {
    mockList = [opener];
    createMutate.mockReset();
    updateMutate.mockReset();
    deleteMutate.mockReset();
  });

  it("lists each piece with what identifies it", () => {
    render(<EquipmentSection dealId="d1" canEdit={false} />);

    const row = screen.getByTestId("equipment-eq-1");
    expect(within(row).getByText("Garage door opener")).toBeInTheDocument();
    expect(within(row).getByText(/LiftMaster · LM-8500/)).toBeInTheDocument();
    expect(within(row).getByText(/SN-42/)).toBeInTheDocument();
    expect(within(row).getByText(/Labor warranty until Sep 29, 2027/)).toBeInTheDocument();
    expect(within(row).getByText(/Garage, left wall/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add equipment" })).not.toBeInTheDocument();
  });

  it("says when there is none", () => {
    mockList = [];
    render(<EquipmentSection dealId="d1" canEdit />);
    expect(screen.getByText("No equipment added")).toBeInTheDocument();
  });

  it("adds a piece from Workiz's form, and needs a name and a model", () => {
    render(<EquipmentSection dealId="d1" canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Add equipment" }));
    const dialog = screen.getByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Equipment name"), { target: { value: "Keypad" } });
    fireEvent.change(within(dialog).getByLabelText("Model #"), { target: { value: "KP-1" } });
    fireEvent.change(within(dialog).getByLabelText("Serial # (optional)"), { target: { value: "S9" } });
    fireEvent.click(save);

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Keypad", model: "KP-1", serial: "S9" }),
      expect.anything(),
    );
  });

  it("edits a piece, clearing a field that was emptied", () => {
    render(<EquipmentSection dealId="d1" canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Garage door opener" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Serial # (optional)"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ equipmentId: "eq-1", body: expect.objectContaining({ serial: null }) }),
      expect.anything(),
    );
  });

  it("removes a piece after asking", () => {
    render(<EquipmentSection dealId="d1" canEdit />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Garage door opener" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove" }));

    expect(deleteMutate).toHaveBeenCalledWith("eq-1");
  });
});
