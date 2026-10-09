import { describe, expect, it } from "vitest";
import { fitColumnWidths } from "@/components/workiz/scroll-grid";
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

  // Workiz's grid is react-table: each column has a minimum (what the 1440×800
  // probe of 2026-10-09 measured, the page too narrow for them to grow) and
  // the ones without a set width share the rest of the page in proportion.
  it("take Workiz's minimum widths, and name the columns that keep theirs", () => {
    const cols = visibleCallColumns(DEFAULT_CALL_FIELDS, [], true);
    expect(cols.map((c) => c.width)).toEqual([70, 160, 100, 120, 180, 100, 135, 180, 100, 100]);
    expect(cols.filter((c) => c.fixed).map((c) => c.id)).toEqual(["status", "from", "flow", "answeredBy"]);
  });

  it("grow to Workiz's widths on its 1398px grid at 1600 (callspage_wz_01)", () => {
    const cols = visibleCallColumns(DEFAULT_CALL_FIELDS, [], true);
    const fit = fitColumnWidths(cols, 1398);
    expect(cols.map((c) => Math.round(fit[c.id]))).toEqual([70, 160, 123, 148, 180, 123, 167, 180, 123, 123]);
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
