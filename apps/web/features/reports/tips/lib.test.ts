import { describe, expect, it } from "vitest";
import type { TipsReportRow } from "@bitcrm/types";
import { jobsParams, reportParams, searchLines, sortLines, tipsCsv } from "./lib";

const line = (techId: string, name: string, tips: number | null, jobs: number): TipsReportRow => ({ techId, name, tips, jobs });

// Workiz 01–27.09: the first people of its default order (user id = account age).
const rows = [
  line("tom", "Tom Tech", 720.53, 91),
  line("yakov", "YAKOV SZENDER", 0, 6),
  line("eli", "Eli Szender", 881.55, 74),
  line("yeter", "Yeter Mizrahi", 213.08, 195),
];
const created = new Map([
  ["yakov", "2017-04-18T19:17:00.000Z"],
  ["eli", "2019-08-06T22:59:00.000Z"],
  ["yeter", "2024-09-26T16:50:00.000Z"],
  ["tom", "2024-11-26T15:04:00.000Z"],
]);

describe("Tips report — web lib", () => {
  it("asks for the period and the three filter groups", () => {
    expect(reportParams({ from: "2026-09-01", to: "2026-09-27", filters: {} })).toBe("from=2026-09-01&to=2026-09-27");
    expect(reportParams({ from: "2026-09-01", to: "2026-09-27", filters: { techId: ["a", "b"], jobTypeId: ["j"], contactId: ["c"] } })).toBe(
      "from=2026-09-01&to=2026-09-27&techId=a%2Cb&jobTypeId=j&contactId=c",
    );
  });

  it("asks for a person's jobs with the report's query, the sort and the page", () => {
    const state = { from: "2026-09-01", to: "2026-09-27", filters: { jobTypeId: ["j"] } };
    expect(jobsParams(state, "t1", "default", "asc", 1)).toBe("from=2026-09-01&to=2026-09-27&jobTypeId=j&tech=t1&page=1");
    expect(jobsParams(state, "t1", "tip", "desc", 2)).toBe("from=2026-09-01&to=2026-09-27&jobTypeId=j&tech=t1&sort=tip&dir=desc&page=2");
  });

  it("lists people in the order their accounts were made in, as Workiz does before a header is clicked", () => {
    expect(sortLines(rows, "default", "asc", created).map((r) => r.techId)).toEqual(["yakov", "eli", "yeter", "tom"]);
    // Without the directory (a viewer who may not list users): by name.
    expect(sortLines(rows, "default", "asc").map((r) => r.techId)).toEqual(["eli", "tom", "yakov", "yeter"]);
  });

  it("sorts on Tech, Tip total and Jobs — numbers as numbers", () => {
    expect(sortLines(rows, "tips", "desc", created).map((r) => r.tips)).toEqual([881.55, 720.53, 213.08, 0]);
    expect(sortLines(rows, "jobs", "asc", created).map((r) => r.jobs)).toEqual([6, 74, 91, 195]);
    expect(sortLines(rows, "name", "asc", created).map((r) => r.name)).toEqual(["Eli Szender", "Tom Tech", "YAKOV SZENDER", "Yeter Mizrahi"]);
  });

  it("searches the name only, any case", () => {
    expect(searchLines(rows, "tom").map((r) => r.techId)).toEqual(["tom"]);
    expect(searchLines(rows, "  SZENDER ").map((r) => r.techId)).toEqual(["yakov", "eli"]);
    expect(searchLines(rows, "")).toHaveLength(4);
  });

  it("exports every line in the order on screen: Tech, Tip total, Jobs", () => {
    expect(tipsCsv(sortLines(rows, "default", "asc", created), true)).toBe(
      "Tech,Tip total,Jobs\nYAKOV SZENDER,0.00,6\nEli Szender,881.55,74\nYeter Mizrahi,213.08,195\nTom Tech,720.53,91",
    );
    expect(tipsCsv([line("x", "=HYPERLINK()", null, 1)], false)).toBe("Tech,Jobs\n'=HYPERLINK(),1");
  });
});
