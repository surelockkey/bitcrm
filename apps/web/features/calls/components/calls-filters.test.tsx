import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, screen, within } from "@testing-library/react";
import type { CallTag } from "@bitcrm/types";
import { renderWithClient } from "@/test/render-with-client";
import type { CallFilterChip, CallFilterKind } from "../call-filters";

/**
 * The filter row's panels as Workiz draws them (callspage_wz_05_filter_*):
 * checkboxes with "Select All" where several can be ticked, radios for
 * Duration and Masking calls, the catalogs' names for Call Flow, Ad Group,
 * User and Tags. A kind the viewer has nothing to pick from is not offered.
 */
const mocks = vi.hoisted(() => ({
  canSettings: true,
  flowsEnabled: [] as boolean[],
}));

vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: (r: string) => (r === "settings" ? mocks.canSettings : true), isLoading: false }),
}));
vi.mock("@/features/telephony/call-flows-hooks", () => ({
  useCallFlows: (enabled: boolean) => {
    mocks.flowsEnabled.push(enabled);
    return { data: enabled ? [{ id: "f1", name: "(2-CT-GMB) SURE CT GMB" }] : undefined };
  },
}));
vi.mock("@/features/job-sources/hooks", () => ({
  useJobSources: () => ({ data: [{ id: "s1", name: "SURE CT NEW HAVEN GMB", active: true }] }),
}));
vi.mock("@/features/telephony/api", () => ({
  listTransferTargets: async () => [{ id: "u1", name: "(1) (Amber) 19 Dispatcher" }],
}));

import { CallsFilterRow } from "./calls-filters";

const TAGS = [{ id: "t1", name: "WRONG NUMBER", active: true }] as CallTag[];

function Harness({ tags = TAGS, onChips }: { tags?: CallTag[]; onChips?: (c: CallFilterChip[]) => void }) {
  const [chips, setChips] = useState<CallFilterChip[]>([]);
  const [open, setOpen] = useState<CallFilterKind | null>(null);
  return (
    <CallsFilterRow
      chips={chips}
      onChipsChange={(c) => {
        setChips(c);
        onChips?.(c);
      }}
      openKind={open}
      onOpenKind={setOpen}
      callTags={tags}
      range={{ preset: "today", from: "2026-10-08", to: "2026-10-08" }}
      onRangeChange={() => undefined}
    />
  );
}

function addFilter(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

describe("CallsFilterRow", () => {
  beforeEach(() => {
    mocks.canSettings = true;
    mocks.flowsEnabled.length = 0;
  });

  it("offers Workiz's filters in Workiz's order", () => {
    renderWithClient(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));

    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Direction",
      "Status",
      "Duration",
      "Job Status",
      "Call Flow",
      "Ad Group",
      "User",
      "Tags",
      "Masking calls",
    ]);
  });

  it("leaves out Call Flow and Tags for a viewer without settings.view", () => {
    mocks.canSettings = false;
    renderWithClient(<Harness tags={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add filter" }));

    const kinds = screen.getAllByRole("menuitem").map((m) => m.textContent);
    expect(kinds).not.toContain("Call Flow");
    expect(kinds).not.toContain("Tags");
  });

  it("Status: Workiz's four categories as checkboxes, several applied at once", () => {
    const onChips = vi.fn();
    renderWithClient(<Harness onChips={onChips} />);
    addFilter("Status");

    const panel = screen.getByPlaceholderText("Search status").closest("div")!.parentElement!.parentElement!;
    expect(within(panel).getAllByRole("checkbox")).toHaveLength(5); // Select All + four
    fireEvent.click(within(panel).getByLabelText("Missed"));
    fireEvent.click(within(panel).getByLabelText("Voicemail"));
    fireEvent.click(within(panel).getByRole("button", { name: "Apply" }));

    expect(onChips).toHaveBeenLastCalledWith([{ kind: "status", values: ["missed", "voicemail"] }]);
    expect(screen.getByRole("button", { name: "Status is Missed, Voicemail" })).toBeInTheDocument();
  });

  it("Duration: Workiz's six radios", () => {
    renderWithClient(<Harness />);
    addFilter("Duration");

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(6);
    expect(screen.getByLabelText("Over 5 min")).toBeInTheDocument();
  });

  it("Ad Group and Call Flow list the catalogs by name; flows are asked for only once wanted", () => {
    renderWithClient(<Harness />);
    expect(mocks.flowsEnabled.every((e) => !e)).toBe(true);

    addFilter("Ad Group");
    expect(screen.getByLabelText("SURE CT NEW HAVEN GMB")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    addFilter("Call Flow");
    expect(mocks.flowsEnabled[mocks.flowsEnabled.length - 1]).toBe(true);
    expect(screen.getByLabelText("(2-CT-GMB) SURE CT GMB")).toBeInTheDocument();
  });

  it("Job Status: the two rows a call can answer", () => {
    renderWithClient(<Harness />);
    addFilter("Job Status");

    expect(screen.getByLabelText("All with job")).toBeInTheDocument();
    expect(screen.getByLabelText("No job linked")).toBeInTheDocument();
  });

  it("Masking calls: Yes / No radios", () => {
    renderWithClient(<Harness />);
    addFilter("Masking calls");

    expect(screen.getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["Yes", "No"]);
  });
});
