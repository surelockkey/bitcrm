import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { suggested, resolvedArea, directory } = vi.hoisted(() => ({
  suggested: { data: [] as unknown[], isLoading: false },
  resolvedArea: { data: undefined },
  directory: { map: new Map<string, { id: string; firstName: string; lastName: string }>() },
}));

vi.mock("../hooks", () => ({
  useSuggestedTechs: () => suggested,
  useUserMap: () => directory,
}));
vi.mock("@/features/service-areas/hooks", () => ({
  useResolvedServiceArea: () => resolvedArea,
}));
// The row's buttons reach for the router, the softphone and the inbox; they
// have their own test, and here they are only along for the ride.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/telephony/softphone-manager", () => ({ startCall: vi.fn() }));
vi.mock("@/features/messaging/api", () => ({ getConversationByParty: () => Promise.resolve(null) }));

import { TeamSection } from "./team-section";

/**
 * Workiz lists a job's team down the page — one technician per row, with the
 * things you do with that person on the right — and puts the picker underneath.
 * Our chips sat in a line with nowhere to put any of it.
 */
describe("TeamSection", () => {
  const tech = (id: string, first: string, last: string) => [id, { id, firstName: first, lastName: last }] as const;

  it("gives each technician a row of their own", () => {
    directory.map = new Map([tech("u1", "Reonquez", "Thompson"), tech("u2", "David", "Szender")]);

    render(<TeamSection techIds={["u1", "u2"]} canEdit onChange={vi.fn()} address={{ lat: 41.7, lng: -72.6 }} jobTypeId="jt1" />);

    expect(screen.getByText("Reonquez Thompson")).toBeInTheDocument();
    expect(screen.getByText("David Szender")).toBeInTheDocument();
  });

  it("keeps the picker below the team, not in place of it", () => {
    directory.map = new Map([tech("u1", "Reonquez", "Thompson")]);

    render(<TeamSection techIds={["u1"]} canEdit onChange={vi.fn()} address={{ lat: 41.7, lng: -72.6 }} jobTypeId="jt1" />);

    expect(screen.getByText("Reonquez Thompson")).toBeInTheDocument();
    expect(screen.getByLabelText("Assign team members")).toBeInTheDocument();
  });

  it("says so plainly when nobody is on the job", () => {
    directory.map = new Map();

    render(<TeamSection techIds={[]} canEdit onChange={vi.fn()} address={{ lat: 41.7, lng: -72.6 }} jobTypeId="jt1" />);

    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("offers no picker and no removing to a viewer who may not edit", () => {
    directory.map = new Map([tech("u1", "Reonquez", "Thompson")]);

    render(<TeamSection techIds={["u1"]} canEdit={false} onChange={vi.fn()} address={{}} jobTypeId="jt1" />);

    expect(screen.getByText("Reonquez Thompson")).toBeInTheDocument();
    expect(screen.queryByLabelText("Assign team members")).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("takes a technician off the job from their own row", async () => {
    const onChange = vi.fn();
    directory.map = new Map([tech("u1", "Reonquez", "Thompson"), tech("u2", "David", "Szender")]);

    render(<TeamSection techIds={["u1", "u2"]} canEdit onChange={onChange} address={{ lat: 41.7, lng: -72.6 }} jobTypeId="jt1" />);
    screen.getByRole("button", { name: "Remove Reonquez Thompson" }).click();

    expect(onChange).toHaveBeenCalledWith(["u2"]);
  });
});
