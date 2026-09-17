import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QualifiedTech } from "../api";

const { qualified, assign } = vi.hoisted(() => ({
  qualified: { data: [] as QualifiedTech[], isLoading: false },
  assign: { mutate: vi.fn(), isPending: false },
}));

vi.mock("../hooks", () => ({
  useQualifiedTechs: () => qualified,
  useAssignTechs: () => assign,
}));
vi.mock("../tech-stock", () => ({
  useTechStock: () => ({ data: new Map(), isLoading: false, isError: false }),
}));
vi.mock("@/features/inventory/warehouses/hooks", () => ({
  useProductMap: () => ({ data: new Map() }),
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
    expect(screen.getByText("Not technicians")).toBeInTheDocument();
  });

  it("says why, in words that do not imply they are a technician", () => {
    qualified.data = [tech({ id: "ghost", eligible: false, reasons: ["not_assignable"] })];
    show();

    expect(screen.getByText("Not a technician")).toBeInTheDocument();
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

  it("leaves a real technician who can't take this job selectable", () => {
    qualified.data = [tech({ id: "real", eligible: false, reasons: ["outside_area"] })];
    show();

    expect(screen.getByLabelText("Assign Alex Rivera")).not.toBeDisabled();
    expect(screen.getByText("Outside service area")).toBeInTheDocument();
  });
});
