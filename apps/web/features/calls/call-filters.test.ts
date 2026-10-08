import { describe, expect, it } from "vitest";
import {
  addableFilters,
  chipSummary,
  DIRECTION_OPTIONS,
  DURATION_OPTIONS,
  FILTER_KINDS,
  JOB_OPTIONS,
  MASKING_OPTIONS,
  STATUS_OPTIONS,
  toCallsFilter,
  type CallFilterChip,
  type CallFilterKind,
} from "./call-filters";

/**
 * Workiz's "+ Add filter" (callspage_wz_05_*): pick a kind, get a chip
 * "Direction is (any)" with a panel of options under it, tick, Apply. Every
 * panel Workiz draws with checkboxes takes several values (the server takes
 * comma lists); Duration and Masking calls are radios. Job Status offers only
 * what a call row can answer — linked to a job or not — since a job's status
 * lives with the job.
 */
describe("FILTER_KINDS", () => {
  it("are Workiz's filters, in Workiz's order", () => {
    expect(FILTER_KINDS.map((k) => k.label)).toEqual([
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

  it("are checkboxes where Workiz has them, radios for Duration and Masking calls", () => {
    expect(FILTER_KINDS.filter((k) => !k.multi).map((k) => k.kind)).toEqual(["duration", "masking"]);
  });
});

describe("the fixed panels", () => {
  it("Direction reads as Workiz's: Outgoing calls, then Incoming calls", () => {
    expect(DIRECTION_OPTIONS).toEqual([
      { value: "outbound", label: "Outgoing calls" },
      { value: "inbound", label: "Incoming calls" },
    ]);
  });

  it("Status is Workiz's four categories (blocked calls and response-needed are Workiz-only)", () => {
    expect(STATUS_OPTIONS.map((o) => o.label)).toEqual(["Answered", "Missed", "Active", "Voicemail"]);
    expect(STATUS_OPTIONS.map((o) => o.value)).toEqual(["answered", "missed", "active", "voicemail"]);
  });

  it("Duration is Workiz's six choices", () => {
    expect(DURATION_OPTIONS.map((o) => o.label)).toEqual([
      "Under 30 sec",
      "Under 1 min",
      "Over 1 min",
      "Under 3 min",
      "Over 3 min",
      "Over 5 min",
    ]);
  });

  it("Job Status offers what the call itself knows", () => {
    expect(JOB_OPTIONS.map((o) => o.label)).toEqual(["All with job", "No job linked"]);
  });

  it("Masking calls is Yes / No", () => {
    expect(MASKING_OPTIONS.map((o) => o.label)).toEqual(["Yes", "No"]);
  });
});

describe("toCallsFilter", () => {
  const base = { q: "jane", dateFrom: "2026-10-08T04:00:00.000Z", dateTo: "2026-10-09T03:59:59.999Z" };

  it("keeps the search and the window when no chip is set", () => {
    expect(toCallsFilter([], base)).toEqual(base);
  });

  it("narrows to one direction; both, or none, are any", () => {
    expect(toCallsFilter([{ kind: "direction", values: ["inbound"] }], base)).toEqual({ ...base, direction: "inbound" });
    expect(toCallsFilter([{ kind: "direction", values: ["outbound", "inbound"] }], base)).toEqual(base);
    expect(toCallsFilter([{ kind: "direction", values: [] }], base)).toEqual(base);
  });

  it("sends the checkbox panels as the server's comma lists", () => {
    const chips: CallFilterChip[] = [
      { kind: "status", values: ["missed", "voicemail"] },
      { kind: "flow", values: ["f1", "f2"] },
      { kind: "source", values: ["s1"] },
      { kind: "user", values: ["u-1", "u-2"] },
      { kind: "tag", values: ["ct-9", "ct-3"] },
    ];
    expect(toCallsFilter(chips, base)).toEqual({
      ...base,
      status: "missed,voicemail",
      flowId: "f1,f2",
      sourceId: "s1",
      agentId: "u-1,u-2",
      tagId: "ct-9,ct-3",
    });
  });

  it.each([
    ["under30", { maxDuration: "29" }],
    ["under60", { maxDuration: "59" }],
    ["over60", { minDuration: "61" }],
    ["under180", { maxDuration: "179" }],
    ["over180", { minDuration: "181" }],
    ["over300", { minDuration: "301" }],
  ])("turns Duration %s into whole-second bounds", (value, bounds) => {
    expect(toCallsFilter([{ kind: "duration", values: [value] }], {})).toEqual(bounds);
  });

  it("Job Status: one choice is a yes/no, both are any", () => {
    expect(toCallsFilter([{ kind: "job", values: ["with"] }], {})).toEqual({ hasJob: "true" });
    expect(toCallsFilter([{ kind: "job", values: ["none"] }], {})).toEqual({ hasJob: "false" });
    expect(toCallsFilter([{ kind: "job", values: ["with", "none"] }], {})).toEqual({});
  });

  it("Masking calls is a yes/no", () => {
    expect(toCallsFilter([{ kind: "masking", values: ["yes"] }], {})).toEqual({ masked: "true" });
    expect(toCallsFilter([{ kind: "masking", values: ["no"] }], {})).toEqual({ masked: "false" });
  });

  it("drops an empty search", () => {
    expect(toCallsFilter([], { q: undefined })).toEqual({});
  });
});

describe("chipSummary", () => {
  const names: Record<string, string> = {
    "direction:inbound": "Incoming calls",
    "direction:outbound": "Outgoing calls",
    "status:missed": "Missed",
    "status:answered": "Answered",
    "tag:ct-9": "SPAM CALLER",
  };
  const labels = (kind: CallFilterKind, value: string) => names[`${kind}:${value}`] ?? value;

  it("says (any) until something is ticked, as Workiz's chip does", () => {
    expect(chipSummary({ kind: "direction", values: [] }, labels)).toEqual({ name: "Direction", value: "(any)" });
  });

  it("names what is ticked", () => {
    expect(chipSummary({ kind: "tag", values: ["ct-9"] }, labels)).toEqual({ name: "Tags", value: "SPAM CALLER" });
  });

  it("lists a fixed panel's picks in the panel's order", () => {
    expect(chipSummary({ kind: "direction", values: ["inbound", "outbound"] }, labels).value).toBe(
      "Outgoing calls, Incoming calls",
    );
    expect(chipSummary({ kind: "status", values: ["missed", "answered"] }, labels).value).toBe("Answered, Missed");
  });
});

describe("addableFilters", () => {
  const all: Record<CallFilterKind, boolean> = {
    direction: true,
    status: true,
    duration: true,
    job: true,
    flow: true,
    source: true,
    user: true,
    tag: true,
    masking: true,
  };

  it("offers every kind not already on a chip", () => {
    expect(addableFilters([{ kind: "status", values: [] }], "", all).map((k) => k.kind)).not.toContain("status");
    expect(addableFilters([], "", all)).toHaveLength(9);
  });

  it("narrows by the menu's search box, case-insensitively", () => {
    expect(addableFilters([], "TA", all).map((k) => k.kind)).toEqual(["status", "job", "tag"]);
  });

  it("leaves out a kind the viewer has nothing to pick from", () => {
    const kinds = addableFilters([], "", { ...all, tag: false, flow: false }).map((k) => k.kind);
    expect(kinds).not.toContain("tag");
    expect(kinds).not.toContain("flow");
  });
});
