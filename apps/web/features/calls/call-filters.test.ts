import { describe, expect, it } from "vitest";
import {
  addableFilters,
  chipSummary,
  DIRECTION_OPTIONS,
  FILTER_KINDS,
  toCallsFilter,
  type CallFilterChip,
} from "./call-filters";

/**
 * Workiz's "+ Add filter" (callspage_wz_05_*): pick a kind, get a chip
 * "Direction is (any)" with a panel of options under it, tick, Apply. Ours
 * offers the kinds `GET /telephony/calls` can filter by — direction, status,
 * the agent, a call tag — and turns the chips into its query.
 */
describe("FILTER_KINDS", () => {
  it("are Workiz's names for the filters the call log can serve, in Workiz's order", () => {
    expect(FILTER_KINDS.map((k) => k.label)).toEqual(["Direction", "Status", "User", "Tags"]);
  });

  it("lets only Direction take several values — the server filters the rest by one", () => {
    expect(FILTER_KINDS.filter((k) => k.multi).map((k) => k.kind)).toEqual(["direction"]);
  });
});

describe("DIRECTION_OPTIONS", () => {
  it("reads as Workiz's panel: Outgoing calls, then Incoming calls", () => {
    expect(DIRECTION_OPTIONS).toEqual([
      { value: "outbound", label: "Outgoing calls" },
      { value: "inbound", label: "Incoming calls" },
    ]);
  });
});

describe("toCallsFilter", () => {
  const base = { number: "860", dateFrom: "2026-10-08T04:00:00.000Z", dateTo: "2026-10-09T03:59:59.999Z" };

  it("keeps the search and the window when no chip is set", () => {
    expect(toCallsFilter([], base)).toEqual(base);
  });

  it("narrows to one direction when exactly one is ticked", () => {
    const chips: CallFilterChip[] = [{ kind: "direction", values: ["inbound"] }];
    expect(toCallsFilter(chips, base)).toEqual({ ...base, direction: "inbound" });
  });

  it("treats both directions, or none, as any", () => {
    expect(toCallsFilter([{ kind: "direction", values: ["outbound", "inbound"] }], base)).toEqual(base);
    expect(toCallsFilter([{ kind: "direction", values: [] }], base)).toEqual(base);
  });

  it("passes status, user and tag through as the server's own parameters", () => {
    const chips: CallFilterChip[] = [
      { kind: "status", values: ["no-answer"] },
      { kind: "user", values: ["u-1"] },
      { kind: "tag", values: ["ct-9"] },
    ];
    expect(toCallsFilter(chips, base)).toEqual({ ...base, status: "no-answer", agentId: "u-1", tagId: "ct-9" });
  });

  it("drops an empty search", () => {
    expect(toCallsFilter([], { number: undefined })).toEqual({});
  });
});

describe("chipSummary", () => {
  const names: Record<string, string> = {
    "direction:inbound": "Incoming calls",
    "direction:outbound": "Outgoing calls",
    "tag:ct-9": "SPAM CALLER",
  };
  const labels = (kind: string, value: string) => names[`${kind}:${value}`] ?? value;

  it("says (any) until something is ticked, as Workiz's chip does", () => {
    expect(chipSummary({ kind: "direction", values: [] }, labels)).toEqual({ name: "Direction", value: "(any)" });
  });

  it("names what is ticked", () => {
    expect(chipSummary({ kind: "direction", values: ["inbound"] }, labels)).toEqual({
      name: "Direction",
      value: "Incoming calls",
    });
    expect(chipSummary({ kind: "tag", values: ["ct-9"] }, labels)).toEqual({ name: "Tags", value: "SPAM CALLER" });
  });

  it("lists several in the panel's order", () => {
    expect(chipSummary({ kind: "direction", values: ["outbound", "inbound"] }, labels).value).toBe(
      "Outgoing calls, Incoming calls",
    );
  });
});

describe("addableFilters", () => {
  const all = { direction: true, status: true, user: true, tag: true };

  it("offers every kind not already on a chip", () => {
    expect(addableFilters([{ kind: "status", values: [] }], "", all).map((k) => k.kind)).toEqual([
      "direction",
      "user",
      "tag",
    ]);
  });

  it("narrows by the menu's search box, case-insensitively", () => {
    expect(addableFilters([], "TA", all).map((k) => k.kind)).toEqual(["status", "tag"]);
  });

  it("leaves out a kind the viewer has nothing to pick from", () => {
    expect(addableFilters([], "", { ...all, tag: false }).map((k) => k.kind)).toEqual(["direction", "status", "user"]);
  });
});
