import { describe, expect, it } from "vitest";
import { callColumnOptions, DEFAULT_CALL_FIELDS, sanitizeCallFields, visibleCallColumns } from "./fields";

/**
 * The call log's columns: Workiz's ten, in Workiz's order and at the widths
 * its grid gives them on a 1600px screen (callspage_wz_01), plus our "Job
 * tags", which Workiz has no column for and so starts switched off.
 */
describe("call log columns", () => {
  it("open on Workiz's ten, in its order", () => {
    expect(visibleCallColumns(DEFAULT_CALL_FIELDS, [], true).map((c) => c.label)).toEqual([
      "Status",
      "From",
      "To",
      "Time",
      "Call Flow",
      "Ad Source",
      "Tags",
      "Answered By",
      "Jobs & Leads",
      "Revenue",
    ]);
  });

  it("take Workiz's widths, which fill its 1398px grid", () => {
    const widths = visibleCallColumns(DEFAULT_CALL_FIELDS, [], true).map((c) => c.width);
    expect(widths).toEqual([70, 160, 123, 148, 180, 124, 167, 180, 123, 123]);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(1398);
  });

  it("keep Revenue — and its place in the Fields drawer — from a viewer who may not see money", () => {
    expect(visibleCallColumns(DEFAULT_CALL_FIELDS, [], false).map((c) => c.id)).not.toContain("revenue");
    expect(callColumnOptions(false).map((c) => c.id)).not.toContain("revenue");
  });

  it("offer Job tags as an opt-in column", () => {
    expect(callColumnOptions(true).map((c) => c.id)).toContain("jobTags");
    expect(visibleCallColumns({ ...DEFAULT_CALL_FIELDS, jobTags: true }, [], true).at(-1)?.label).toBe("Job tags");
  });

  it("follow the order saved in the drawer", () => {
    const cols = visibleCallColumns(DEFAULT_CALL_FIELDS, ["time", "status"], true).map((c) => c.id);
    expect(cols.slice(0, 3)).toEqual(["time", "status", "from"]);
  });
});

describe("sanitizeCallFields", () => {
  it("keeps known columns' choices, fills the rest from the defaults, drops the unknown", () => {
    expect(sanitizeCallFields({ from: false, bogus: true, tags: "yes" })).toEqual({ ...DEFAULT_CALL_FIELDS, from: false });
    expect(sanitizeCallFields(null)).toEqual(DEFAULT_CALL_FIELDS);
  });
});
