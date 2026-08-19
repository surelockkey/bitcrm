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

describe("TechSuggestions", () => {
  beforeEach(() => {
    suggested.data = [];
    suggested.isLoading = false;
    resolvedArea.data = { id: "sa-ct", name: "CT" };
  });

  it("prompts to pick a job type first when none is set", () => {
    render(<TechSuggestions jobTypeId="" address={{ lat: 41.7, lng: -72.6 }} selected={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/pick a job type/i)).toBeInTheDocument();
  });

  it("prompts for the address when the job type is set but there's no address", () => {
    render(<TechSuggestions jobTypeId="jt-x" address={{}} selected={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/add the address/i)).toBeInTheDocument();
  });

  it("lists eligible techs who can do the job and selects them", () => {
    suggested.data = [
      tech({ id: "t1", firstName: "Alex", lastName: "Rivera", distanceMiles: 3 }),
      tech({ id: "t2", firstName: "Bella", lastName: "Cohen", distanceMiles: 8 }),
    ];
    const onChange = vi.fn();
    render(
      <TechSuggestions
        jobTypeId="jt-x"
        address={{ lat: 41.7, lng: -72.6 }}
        selected={[]}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Alex Rivera"));
    expect(onChange).toHaveBeenCalledWith(["t1"]);
  });

  it("separates techs who can't do this job with a reason", () => {
    suggested.data = [
      tech({ id: "t1", firstName: "Alex", lastName: "Rivera" }),
      tech({ id: "t3", firstName: "Gina", lastName: "Ross", eligible: false, reasons: ["missing_job_type"] }),
    ];
    render(<TechSuggestions jobTypeId="jt-x" address={{ lat: 41.7, lng: -72.6 }} selected={[]} onChange={vi.fn()} />);

    expect(screen.getByText("Gina Ross")).toBeInTheDocument();
    expect(screen.getByText(/can't do this job type/i)).toBeInTheDocument();
  });

  it("says nobody can do it when the eligible list is empty", () => {
    suggested.data = [tech({ id: "t3", eligible: false, reasons: ["outside_area"] })];
    render(<TechSuggestions jobTypeId="jt-x" address={{ lat: 41.7, lng: -72.6 }} selected={[]} onChange={vi.fn()} />);

    expect(screen.getByText(/no technician can do this job/i)).toBeInTheDocument();
  });

  it("deselects a chosen tech on a second click", () => {
    suggested.data = [tech({ id: "t1" })];
    const onChange = vi.fn();
    render(<TechSuggestions jobTypeId="jt-x" address={{ lat: 41.7, lng: -72.6 }} selected={["t1"]} onChange={onChange} />);

    fireEvent.click(screen.getByText("Alex Rivera"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
