import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { JobTag } from "@bitcrm/types";

const { catalog } = vi.hoisted(() => ({ catalog: { loading: false } }));

const rush: JobTag = {
  id: "t-rush",
  name: "Rush",
  color: "red",
  priority: 0,
  active: true,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
};

const imported = (id: string, name: string, priority: number): JobTag => ({ ...rush, id, name, color: "blue", priority });
const workiz = [
  imported("bid", "BID/Solicitation", 29),
  imported("plat", "PLATINUM", 97),
  imported("wait", "waiting for an estimate", 139),
];

vi.mock("../hooks", () => ({
  useJobTags: () =>
    catalog.loading ? { data: undefined, isLoading: true } : { data: [rush, ...workiz], isLoading: false },
}));

import { JobTagChips } from "./job-tag-chips";

describe("JobTagChips", () => {
  beforeEach(() => {
    catalog.loading = false;
  });

  it("shows skeleton pills instead of raw ids while the catalog loads", () => {
    catalog.loading = true;
    const { container } = render(<JobTagChips ids={["t-rush"]} />);

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("t-rush")).not.toBeInTheDocument();
  });

  it("falls back to the raw id only once the catalog is loaded (purged tag)", () => {
    render(<JobTagChips ids={["t-gone"]} />);

    expect(screen.getByText("t-gone")).toBeInTheDocument();
  });
});

/**
 * The jobs list prints a job's tags in Workiz's catalog order, whatever order
 * the job keeps them in: LSBE12 reads "waiting for an estimate · PLATINUM ·
 * BID/Solicitation" (list_01_submitted) though dev holds them the other way
 * round. Elsewhere the order given stands.
 */
describe("JobTagChips — catalog order", () => {
  it("lays the tags out in catalog order when asked", () => {
    render(<JobTagChips ids={["bid", "plat", "wait"]} solid catalogOrder />);
    expect(screen.getAllByTitle(/./).map((c) => c.textContent)).toEqual([
      "waiting for an estimate",
      "PLATINUM",
      "BID/Solicitation",
    ]);
  });

  it("keeps the order it was given otherwise", () => {
    render(<JobTagChips ids={["bid", "plat", "wait"]} />);
    expect(screen.getAllByTitle(/./).map((c) => c.textContent)).toEqual([
      "BID/Solicitation",
      "PLATINUM",
      "waiting for an estimate",
    ]);
  });
});
