import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QualifiedTech } from "../api";

const { qualified, assign, carried } = vi.hoisted(() => ({
  qualified: { data: [] as QualifiedTech[], isLoading: false },
  assign: { mutate: vi.fn(), isPending: false },
  carried: { data: [] as { productId: string; productName: string; quantity: number }[] },
}));

vi.mock("../hooks", () => ({
  useQualifiedTechs: () => qualified,
  useAssignTechs: () => assign,
}));
vi.mock("../tech-stock", () => ({
  useTechStock: () => ({ data: carried.data, isLoading: false, isError: false }),
}));

import { AssignTechDialog } from "./assign-tech-dialog";

const tech = (over: Partial<QualifiedTech>): QualifiedTech => ({
  id: "t1",
  firstName: "Alex",
  lastName: "Rivera",
  eligible: true,
  reasons: [],
  distanceMiles: 3.2,
  ...over,
});

const show = (assignedTechIds: string[] = []) =>
  render(
    <AssignTechDialog
      dealId="deal-1"
      assignedTechIds={assignedTechIds}
      open
      onOpenChange={vi.fn()}
    />,
  );

/**
 * The dispatcher's last line of defence. Someone the backend will not vouch for
 * as a technician used to land in "Other technicians" — the same bucket as a
 * real technician who simply can't take this job — with a badge reading "Not
 * yet assignable", which reads as "still onboarding". That is how people who
 * are not technicians came to be assigned to jobs.
 */
describe("AssignTechDialog — a row that is not a technician", () => {
  beforeEach(() => {
    qualified.data = [];
    qualified.isLoading = false;
  });

  it("is not filed under 'Other technicians'", () => {
    qualified.data = [
      tech({ id: "real", firstName: "Bella", eligible: false, reasons: ["missing_job_type"] }),
      tech({ id: "ghost", firstName: "Carlos", eligible: false, reasons: ["not_assignable"] }),
    ];
    show();

    expect(screen.getByText("Other technicians")).toBeInTheDocument();
    expect(screen.getByText("Not on the field team")).toBeInTheDocument();
  });

  it("says why, in words that do not imply they are still onboarding", () => {
    qualified.data = [tech({ id: "ghost", eligible: false, reasons: ["not_assignable"] })];
    show();

    // Since the field-team flag, "not assignable" means exactly one thing:
    // the switch is off for them — whatever their role.
    expect(screen.getByText("Not a field team member")).toBeInTheDocument();
  });

  it("cannot be ticked onto the job", () => {
    qualified.data = [tech({ id: "ghost", eligible: false, reasons: ["not_assignable"] })];
    show();

    expect(screen.getByLabelText("Alex Rivera can't be assigned")).toBeDisabled();
  });

  it("stays removable when they are already on the job", () => {
    qualified.data = [tech({ id: "ghost", eligible: false, reasons: ["not_assignable"] })];
    show(["ghost"]);

    expect(screen.getByLabelText("Assign Alex Rivera")).not.toBeDisabled();
  });

  /**
   * Unticking is how a bad assignment is undone, and the tick is not saved
   * until Apply — so clearing it must not be what locks the row. It did, while
   * the lock keyed off the tick rather than off who is on the job: one stray
   * click and the only way back was to close the dialog.
   */
  it("can be ticked back on after a mis-click, while still on the job", async () => {
    qualified.data = [tech({ id: "ghost", eligible: false, reasons: ["not_assignable"] })];
    show(["ghost"]);

    const box = screen.getByLabelText("Assign Alex Rivera");
    await userEvent.click(box);

    expect(box).not.toBeChecked();
    expect(box).not.toBeDisabled();

    await userEvent.click(box);
    expect(box).toBeChecked();
  });

  it("leaves a real technician who can't take this job selectable", () => {
    qualified.data = [tech({ id: "real", eligible: false, reasons: ["outside_area"] })];
    show();

    expect(screen.getByLabelText("Assign Alex Rivera")).not.toBeDisabled();
    expect(screen.getByText("Outside service area")).toBeInTheDocument();
  });
});

/**
 * What the technician carries, named by the stock endpoint itself — the
 * dialog used to page the whole stock-managed catalog to put names on it.
 */
describe("AssignTechDialog — carried items", () => {
  beforeEach(() => {
    qualified.data = [tech({})];
    carried.data = [];
  });

  it("lists what the van holds by name, with the quantity", async () => {
    carried.data = [
      { productId: "p1", productName: "Deadbolt", quantity: 3 },
      { productId: "p2", productName: "Key blank", quantity: 40 },
    ];
    show();
    await userEvent.click(screen.getByRole("button", { name: "Show carried items" }));
    expect(screen.getByText("Deadbolt")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
  });

  it("says so when the van is empty", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Show carried items" }));
    expect(screen.getByText("Carries no stock right now.")).toBeInTheDocument();
  });
});
