import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { QualifiedTech } from "../api";

const { suggested, resolvedArea } = vi.hoisted(() => ({
  suggested: { data: [] as QualifiedTech[], isLoading: false },
  resolvedArea: { data: undefined as { id: string; name: string } | undefined },
}));

vi.mock("../hooks", () => ({
  useSuggestedTechs: () => suggested,
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useResolvedServiceArea: () => resolvedArea,
}));

import { TechSuggestions } from "./tech-suggestions";

const tech = (over: Partial<QualifiedTech>): QualifiedTech => ({
  id: "t1",
  firstName: "Alex",
  lastName: "Rivera",
  eligible: true,
  reasons: [],
  distanceMiles: 3.2,
  ...over,
});

const open = () => fireEvent.click(screen.getByLabelText("Assign team members"));

describe("TechSuggestions — select", () => {
  beforeEach(() => {
    suggested.data = [];
    suggested.isLoading = false;
    resolvedArea.data = { id: "sa-ct", name: "CT" };
  });

  it("with no address: a disabled select asking for the address", () => {
    render(<TechSuggestions jobTypeId="jt-x" address={{}} selected={[]} onChange={vi.fn()} />);
    const trigger = screen.getByLabelText("Assign team members");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent(/enter the address first/i);
  });

  it("address but no job type: counts techs who can do any job type", () => {
    suggested.data = [tech({ id: "t1" }), tech({ id: "t2", firstName: "Bella" })];
    render(<TechSuggestions jobTypeId="" address={{ lat: 41.7, lng: -72.6 }} selected={[]} onChange={vi.fn()} />);

    expect(screen.getByText(/2 technicians can do any job type/i)).toBeInTheDocument();
  });

  it("with a job type: counts techs who can do this job", () => {
    suggested.data = [tech({ id: "t1" }), tech({ id: "t2", firstName: "Bella" }), tech({ id: "t3", firstName: "Gina", eligible: false, reasons: ["missing_job_type"] })];
    render(<TechSuggestions jobTypeId="jt-x" address={{ lat: 41.7, lng: -72.6 }} selected={[]} onChange={vi.fn()} />);

    // Only the 2 eligible count for "can do this job".
    expect(screen.getByText(/2 can do this job/i)).toBeInTheDocument();
  });

  it("opens the select and toggles a technician", () => {
    suggested.data = [tech({ id: "t1" })];
    const onChange = vi.fn();
    render(<TechSuggestions jobTypeId="jt-x" address={{ lat: 41.7, lng: -72.6 }} selected={[]} onChange={onChange} />);

    open();
    fireEvent.click(screen.getByText("Alex Rivera"));
    expect(onChange).toHaveBeenCalledWith(["t1"]);
  });

  it("shows chosen technicians as chips on the trigger", () => {
    suggested.data = [tech({ id: "t1" })];
    render(<TechSuggestions jobTypeId="jt-x" address={{ lat: 41.7, lng: -72.6 }} selected={["t1"]} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Assign team members")).toHaveTextContent("Alex Rivera");
  });
});
